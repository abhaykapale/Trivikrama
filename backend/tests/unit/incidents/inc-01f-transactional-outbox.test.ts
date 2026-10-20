import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  ClaimIncidentNotificationsInput,
  FailIncidentNotificationInput,
  IncidentNotificationOutboxRecord,
} from "../../../src/database/repositories/incident-notification-outbox/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import {
  createIncidentNotification,
  IncidentNotificationDispatcher,
  RedisIncidentNotificationPublisher,
  type IncidentNotificationPublisher,
  type RedisScriptExecutor,
} from "../../../src/modules/incidents/index.js";

const NOW = new Date("2026-10-11T12:00:00.000Z");

test("builds deterministic tenant-scoped incident notification contracts", () => {
  const first = createIncidentNotification({
    incident: incident(),
    type: "INCIDENT_CREATED",
    occurredAt: NOW,
    causationId: "alert-1",
  });
  const replay = createIncidentNotification({
    incident: incident(),
    type: "INCIDENT_CREATED",
    occurredAt: NOW,
    causationId: "alert-1",
  });

  assert.deepEqual(replay, first);
  assert.equal(first.channel, "incidents:new");
  assert.equal(first.payload.orgId, "org-a");
  assert.equal(first.payload.data.incidentId, incident().id);
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test("publishes once through the atomic Redis deduplication script", async () => {
  const redis = new FakeRedis();
  const publisher = new RedisIncidentNotificationPublisher(redis, {
    deduplicationTtlSeconds: 60,
  });
  const notification = outboxRecord();

  const first = await publisher.publish(notification);
  const replay = await publisher.publish(notification);

  assert.deepEqual(first, { published: true, subscriberCount: 2 });
  assert.deepEqual(replay, { published: false, subscriberCount: 0 });
  assert.equal(redis.publications.length, 1);
  assert.equal(redis.publications[0]?.channel, "incidents:new");
  assert.deepEqual(JSON.parse(redis.publications[0]!.message), notification.payload);
});

test("dispatches and acknowledges a claimed notification", async () => {
  const outbox = new InMemoryOutbox([outboxRecord()]);
  const publisher = new FakePublisher();
  const dispatcher = new IncidentNotificationDispatcher({
    outbox,
    publisher,
    owner: "worker-a",
    now: () => NOW,
  });

  const result = await dispatcher.dispatchBatch();

  assert.deepEqual(result, {
    claimed: 1,
    published: 1,
    deduplicated: 0,
    failed: 0,
    deadLettered: 0,
  });
  assert.equal(outbox.records[0]?.status, "published");
  assert.equal(outbox.records[0]?.attemptCount, 1);
});

test("retains a failed notification with bounded exponential retry", async () => {
  const outbox = new InMemoryOutbox([outboxRecord()]);
  const publisher = new FakePublisher(new Error("redis unavailable\nsecret=redacted"));
  const dispatcher = new IncidentNotificationDispatcher({
    outbox,
    publisher,
    owner: "worker-a",
    now: () => NOW,
    configuration: { baseRetryDelayMs: 2_000, maxRetryDelayMs: 10_000 },
  });

  const result = await dispatcher.dispatchBatch();

  assert.equal(result.failed, 1);
  assert.equal(outbox.records[0]?.status, "pending");
  assert.equal(outbox.records[0]?.attemptCount, 1);
  assert.equal(outbox.records[0]?.availableAt.toISOString(), "2026-10-11T12:00:02.000Z");
  assert.doesNotMatch(outbox.records[0]?.lastError ?? "", /\n/u);
});

test("dead-letters a notification after the configured maximum attempts", async () => {
  const outbox = new InMemoryOutbox([{ ...outboxRecord(), attemptCount: 2 }]);
  const dispatcher = new IncidentNotificationDispatcher({
    outbox,
    publisher: new FakePublisher(new Error("still unavailable")),
    owner: "worker-a",
    now: () => NOW,
    configuration: { maxAttempts: 3 },
  });

  const result = await dispatcher.dispatchBatch();

  assert.equal(result.deadLettered, 1);
  assert.equal(outbox.records[0]?.status, "dead_letter");
  assert.equal(outbox.records[0]?.attemptCount, 3);
});

test("two dispatchers cannot claim the same outbox row", async () => {
  const outbox = new InMemoryOutbox([outboxRecord()]);
  const publisher = new FakePublisher();
  const first = new IncidentNotificationDispatcher({
    outbox,
    publisher,
    owner: "worker-a",
    now: () => NOW,
  });
  const second = new IncidentNotificationDispatcher({
    outbox,
    publisher,
    owner: "worker-b",
    now: () => NOW,
  });

  const results = await Promise.all([first.dispatchBatch(), second.dispatchBatch()]);

  assert.equal(results[0]!.claimed + results[1]!.claimed, 1);
  assert.equal(publisher.calls, 1);
});

test("migration enforces replay, channel, payload, and dispatch invariants", async () => {
  const migration = await readFile(
    `${process.cwd()}/migrations/postgres/20261011000200_inc_01f_incident_notification_outbox.js`,
    "utf8",
  );

  assert.match(migration, /deduplication_key VARCHAR\(500\) NOT NULL UNIQUE/u);
  assert.match(migration, /chk_incident_outbox_event_channel/u);
  assert.match(migration, /jsonb_typeof\(payload\) = 'object'/u);
  assert.match(migration, /WHERE status = 'pending'/u);
});

class FakeRedis implements RedisScriptExecutor {
  public readonly seen = new Set<string>();
  public readonly publications: Array<{ channel: string; message: string }> = [];

  public async eval(
    _script: string,
    _numberOfKeys: number,
    ...args: readonly (string | number)[]
  ): Promise<unknown> {
    const [key, _value, _ttl, channel, message] = args.map(String);
    if (this.seen.has(key!)) return [-1, 0];
    this.seen.add(key!);
    this.publications.push({ channel: channel!, message: message! });
    return [1, 2];
  }
}

class FakePublisher implements IncidentNotificationPublisher {
  public calls = 0;

  public constructor(private readonly failure?: Error) {}

  public async publish() {
    this.calls += 1;
    if (this.failure !== undefined) throw this.failure;
    return { published: true, subscriberCount: 1 } as const;
  }
}

class InMemoryOutbox {
  public records: IncidentNotificationOutboxRecord[];

  public constructor(records: readonly IncidentNotificationOutboxRecord[]) {
    this.records = [...structuredClone(records)];
  }

  public async claimBatch(input: ClaimIncidentNotificationsInput) {
    const claimed: IncidentNotificationOutboxRecord[] = [];
    this.records = this.records.map((record) => {
      if (
        claimed.length >= input.limit ||
        record.status !== "pending" ||
        record.availableAt > input.now ||
        (record.lockedUntil !== null && record.lockedUntil > input.now)
      ) return record;
      const next = {
        ...record,
        lockedAt: input.now,
        lockedUntil: input.lockedUntil,
        lockOwner: input.owner,
      };
      claimed.push(next);
      return next;
    });
    return claimed;
  }

  public async markPublished(id: string, owner: string, publishedAt: Date) {
    return this.replace(id, owner, (record) => ({
      ...record,
      status: "published",
      attemptCount: record.attemptCount + 1,
      publishedAt,
      lockOwner: null,
      lockedAt: null,
      lockedUntil: null,
      lastError: null,
      updatedAt: publishedAt,
    }));
  }

  public async markFailed(id: string, input: FailIncidentNotificationInput) {
    return this.replace(id, input.owner, (record) => ({
      ...record,
      status: input.deadLetter ? "dead_letter" : "pending",
      attemptCount: record.attemptCount + 1,
      availableAt: input.nextAvailableAt,
      lockOwner: null,
      lockedAt: null,
      lockedUntil: null,
      lastError: input.error,
      updatedAt: input.now,
    }));
  }

  private replace(
    id: string,
    owner: string,
    change: (record: IncidentNotificationOutboxRecord) => IncidentNotificationOutboxRecord,
  ): IncidentNotificationOutboxRecord | null {
    const index = this.records.findIndex(
      (record) => record.id === id && record.lockOwner === owner && record.status === "pending",
    );
    if (index < 0) return null;
    const next = change(this.records[index]!);
    this.records[index] = next;
    return next;
  }
}

function outboxRecord(): IncidentNotificationOutboxRecord {
  const value = createIncidentNotification({
    incident: incident(),
    type: "INCIDENT_CREATED",
    occurredAt: NOW,
    causationId: "alert-1",
  });
  return {
    ...value,
    status: "pending",
    attemptCount: 0,
    availableAt: NOW,
    lockedAt: null,
    lockedUntil: null,
    lockOwner: null,
    publishedAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function incident(): IncidentRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "HIGH - Failed Login on web-01",
    description: null,
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "web-01",
    entityType: "host",
    entities: [{ type: "host", value: "web-01" }],
    killChainStages: [],
    alertCount: 2,
    eventCount: 1,
    assignedTo: null,
    firstEventAt: NOW,
    lastEventAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
    closedAt: null,
    orgId: "org-a",
  };
}
