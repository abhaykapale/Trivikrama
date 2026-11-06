import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { MongoDbClient } from "../../../src/database/mongodb/client.js";
import type { AiResultDocument } from "../../../src/database/repositories/mongodb/ai-result.repository.js";
import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { MongoEventInvestigationRepository } from "../../../src/modules/events/infrastructure/mongo-event-investigation.repository.js";

test("Mongo event search always combines tenant, time, and allowlisted filters", async () => {
  const fake = new FakeMongo();
  fake.eventDocuments = [eventDocument()];
  fake.total = 1;
  const repository = new MongoEventInvestigationRepository(fake.client());

  const result = await repository.search({
    orgId: "org-alpha",
    query: "failed password",
    classUid: 3002,
    severityId: 4,
    srcIp: "192.0.2.10",
    dstIp: "10.0.0.5",
    username: "root",
    hostname: "web-01",
    collectorId: "collector-1",
    from: new Date("2026-10-21T00:00:00.000Z"),
    to: new Date("2026-10-22T00:00:00.000Z"),
    offset: 40,
    limit: 20,
    sort: "severityId",
    order: "desc",
  });

  assert.deepEqual(fake.eventFindFilter, {
    org_id: "org-alpha",
    time: {
      $gte: new Date("2026-10-21T00:00:00.000Z"),
      $lte: new Date("2026-10-22T00:00:00.000Z"),
    },
    $text: { $search: "failed password" },
    class_uid: 3002,
    severity_id: 4,
    "src_endpoint.ip": "192.0.2.10",
    "dst_endpoint.ip": "10.0.0.5",
    "actor.user.name": "root",
    "device.hostname": "web-01",
    "ingestion.collector_id": "collector-1",
  });
  assert.deepEqual(fake.eventCountFilter, fake.eventFindFilter);
  assert.deepEqual(fake.eventSort, {
    severity_id: -1,
    time: -1,
    event_id: -1,
  });
  assert.equal(fake.eventSkip, 40);
  assert.equal(fake.eventLimit, 20);
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.eventId, "event-1");
  assert.equal("orgId" in (result.items[0] as object), false);
  assert.equal("raw_event" in (result.items[0] as object), false);
});

test("Mongo detail and AI explanation use the same tenant predicate", async () => {
  const fake = new FakeMongo();
  fake.eventDetail = eventDocument();
  fake.aiDetail = aiDocument();
  const repository = new MongoEventInvestigationRepository(fake.client());

  const result = await repository.findById({
    orgId: "org-alpha",
    eventId: "event-1",
  });

  assert.deepEqual(fake.eventDetailFilter, {
    event_id: "event-1",
    org_id: "org-alpha",
  });
  assert.deepEqual(fake.aiFindFilter, {
    event_id: "event-1",
    org_id: "org-alpha",
  });
  assert.equal(result?.aiAnalysis?.modelVersion, "1.0.0");
  assert.equal(result?.aiAnalysis?.shapExplanation?.features[0]?.shapValue, 0.4);
  assert.equal("org_id" in (result as object), false);
  assert.equal("raw_event" in (result as object), false);
});

test("absent tenant-scoped event does not query AI results", async () => {
  const fake = new FakeMongo();
  const repository = new MongoEventInvestigationRepository(fake.client());

  const result = await repository.findById({
    orgId: "org-other",
    eventId: "event-1",
  });

  assert.equal(result, null);
  assert.equal(fake.aiFindFilter, undefined);
});

test("Mongo bootstrap declares tenant-first LOG-01A investigation indexes", async () => {
  const source = await readFile(
    `${process.cwd()}/src/database/mongodb/bootstrap.ts`,
    "utf8",
  );
  for (const name of [
    "idx_org_time_event",
    "idx_org_severity_time_event",
    "idx_org_class_time_event",
    "idx_org_src_ip_time",
    "idx_org_dst_ip_time",
    "idx_org_actor_user_time",
    "idx_org_device_hostname_time",
    "idx_org_collector_time",
    "idx_ai_org_event_created",
  ]) {
    assert.match(source, new RegExp(name, "u"), name);
  }
});

class FakeMongo {
  public eventDocuments: NormalizedEventDocument[] = [];
  public total = 0;
  public eventDetail: NormalizedEventDocument | null = null;
  public aiDetail: AiResultDocument | null = null;
  public eventFindFilter: unknown;
  public eventCountFilter: unknown;
  public eventDetailFilter: unknown;
  public aiFindFilter: unknown;
  public eventSort: unknown;
  public eventSkip: unknown;
  public eventLimit: unknown;

  public client(): MongoDbClient {
    const self = this;
    return {
      readyState: 1,
      db: {
        collection(name: string) {
          if (name === "normalized_events") {
            return {
              find(filter: unknown) {
                self.eventFindFilter = filter;
                return eventCursor(self);
              },
              async countDocuments(filter: unknown) {
                self.eventCountFilter = filter;
                return self.total;
              },
              async findOne(filter: unknown) {
                self.eventDetailFilter = filter;
                return self.eventDetail;
              },
            };
          }
          if (name === "ai_results") {
            return {
              find(filter: unknown) {
                self.aiFindFilter = filter;
                return aiCursor(self);
              },
            };
          }
          throw new Error(`Unexpected collection ${name}`);
        },
      },
    } as unknown as MongoDbClient;
  }
}

function eventCursor(fake: FakeMongo) {
  return {
    sort(value: unknown) {
      fake.eventSort = value;
      return this;
    },
    skip(value: number) {
      fake.eventSkip = value;
      return this;
    },
    limit(value: number) {
      fake.eventLimit = value;
      return this;
    },
    async toArray() {
      return fake.eventDocuments;
    },
  };
}

function aiCursor(fake: FakeMongo) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async next() {
      return fake.aiDetail;
    },
  };
}

function eventDocument(): NormalizedEventDocument {
  return {
    event_id: "event-1",
    class_uid: 3002,
    category_uid: 3,
    severity_id: 4,
    time: new Date("2026-10-22T05:50:00.000Z"),
    message: "Failed password for root",
    src_endpoint: { ip: "192.0.2.10", port: 54321 },
    dst_endpoint: { ip: "10.0.0.5", port: 22 },
    actor: { user: { name: "root" } },
    device: { hostname: "web-01" },
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: "batch-1",
      collector_id: "collector-1",
      ingested_at: new Date("2026-10-22T05:50:01.000Z"),
    },
    org_id: "org-alpha",
    raw_event: { secret: "must-not-leak" },
  };
}

function aiDocument(): AiResultDocument {
  return {
    event_id: "event-1",
    model_name: "isolation_forest",
    model_version: "1.0.0",
    anomaly_score: 0.94,
    is_anomaly: true,
    used_fallback: false,
    created_at: new Date("2026-10-22T05:50:02.000Z"),
    org_id: "org-alpha",
    shap_explanation: {
      base_value: 0.2,
      features: [
        { name: "failed_login_count_10min", value: 38, shap_value: 0.4 },
      ],
    },
  };
}
