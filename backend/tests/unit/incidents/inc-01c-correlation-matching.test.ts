import assert from "node:assert/strict";
import test from "node:test";

import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import {
  IncidentCandidateRanker,
  IncidentCandidateSelector,
  UnifiedAlertEntityExtractor,
  extractEventEntities,
  type IncidentCorrelationCandidateInput,
  type IncidentEntity,
  type UnifiedRuleAlert,
} from "../../../src/modules/incidents/index.js";

const ORG_ID = "incident-test-org";
const ALERT_TIME = new Date("2026-10-11T06:15:00.000Z");

test("extracts and normalizes the approved OCSF correlation entities", () => {
  assert.deepEqual(
    extractEventEntities({
      event_id: "event-1",
      org_id: ORG_ID,
      src_endpoint: {
        ip: "2001:DB8::10",
        hostname: "ATTACKER.CORP.LOCAL",
      },
      dst_endpoint: { ip: "10.0.0.5" },
      actor: { user: { name: "ROOT@LOCALHOST", uid: " 0 " } },
      device: { hostname: "WEB-01.EXAMPLE.LOCAL" },
    }),
    [
      { type: "src_ip", value: "2001:db8::10" },
      { type: "dst_ip", value: "10.0.0.5" },
      { type: "user", value: "root" },
      { type: "user_id", value: "0" },
      { type: "host", value: "web-01" },
      { type: "src_host", value: "attacker" },
    ],
  );
});

test("enriches alerts across matched events and reports unresolved identities", () => {
  const result = new UnifiedAlertEntityExtractor().enrich({
    orgId: ORG_ID,
    alerts: [alert({ matchedEventIds: ["event-2", "missing", "event-1"] })],
    events: [
      {
        event_id: "event-1",
        org_id: ORG_ID,
        actor: { user: { name: "ADMIN" } },
      },
      {
        event_id: "event-2",
        org_id: ORG_ID,
        actor: { user: { name: "admin" } },
        src_endpoint: { ip: "192.0.2.20" },
      },
    ],
  });

  assert.equal(result.eventsResolved, 2);
  assert.deepEqual(result.missingEventIds, ["missing"]);
  assert.deepEqual(result.alerts[0]?.entities, [
    { type: "src_ip", value: "192.0.2.20" },
    { type: "user", value: "admin" },
  ]);
  assert.ok(Object.isFrozen(result.alerts));
  assert.ok(Object.isFrozen(result.alerts[0]?.entities));
});

test("fails closed on cross-tenant or ambiguous normalized events", () => {
  const extractor = new UnifiedAlertEntityExtractor();
  assert.throws(
    () =>
      extractor.enrich({
        orgId: ORG_ID,
        alerts: [alert()],
        events: [{ event_id: "event-1", org_id: "another-org" }],
      }),
    /organization boundary/u,
  );
  assert.throws(
    () =>
      extractor.enrich({
        orgId: ORG_ID,
        alerts: [alert()],
        events: [
          { event_id: "event-1", org_id: ORG_ID },
          { event_id: "event-1", org_id: ORG_ID },
        ],
      }),
    /Duplicate normalized event identity/u,
  );
});

test("ranks by overlap, then recency, then matching source with stable ties", () => {
  const ranker = new IncidentCandidateRanker();
  const candidates = [
    incident("incident-old", {
      entities: entitySet("user", "host"),
      lastEventAt: new Date("2026-10-11T06:10:00.000Z"),
      source: "rule",
    }),
    incident("incident-recent-ai", {
      entities: entitySet("user", "host"),
      lastEventAt: new Date("2026-10-11T06:14:00.000Z"),
      source: "ai",
    }),
    incident("incident-recent-rule", {
      entities: entitySet("user", "host"),
      lastEventAt: new Date("2026-10-11T06:14:00.000Z"),
      source: "rule",
    }),
    incident("incident-one-entity", {
      entities: entitySet("user"),
      lastEventAt: new Date("2026-10-11T06:15:00.000Z"),
      source: "rule",
    }),
  ];

  const result = ranker.rank({ alert: alertWithEntities(), candidates });

  assert.equal(result.selected?.id, "incident-recent-rule");
  assert.deepEqual(
    result.ranked.map((candidate) => candidate.incident.id),
    [
      "incident-recent-rule",
      "incident-recent-ai",
      "incident-old",
      "incident-one-entity",
    ],
  );
  assert.deepEqual(result.ranked[0]?.sharedEntities, entitySet("user", "host"));
});

test("enforces inclusive 15-minute activity and exclusive 24-hour lifetime", () => {
  const ranker = new IncidentCandidateRanker();
  const withinBoundary = incident("within-boundary", {
    lastEventAt: new Date("2026-10-11T06:00:00.000Z"),
  });
  const outsideBoundary = incident("outside-boundary", {
    lastEventAt: new Date("2026-10-11T05:59:59.999Z"),
  });
  const expired = incident("expired", {
    createdAt: new Date("2026-10-10T06:15:00.000Z"),
    lastEventAt: new Date("2026-10-11T06:14:00.000Z"),
  });

  const result = ranker.rank({
    alert: alertWithEntities(),
    candidates: [outsideBoundary, expired, withinBoundary],
    evaluatedAt: ALERT_TIME,
  });

  assert.deepEqual(result.ranked.map((item) => item.incident.id), ["within-boundary"]);
  assert.deepEqual(result.expiredCandidateIds, ["expired"]);
});

test("selector performs a tenant-scoped repository lookup with configured window", async () => {
  const repository = new RecordingCandidateRepository([
    incident("selected", { lastEventAt: new Date("2026-10-11T06:14:00.000Z") }),
  ]);
  const selector = new IncidentCandidateSelector(repository);

  const result = await selector.select({ alert: alertWithEntities() });

  assert.equal(result.selected?.id, "selected");
  assert.deepEqual(repository.input, {
    orgId: ORG_ID,
    entities: entitySet("user", "host"),
    activeAfter: new Date("2026-10-11T06:00:00.000Z"),
    limit: 25,
  });
});

test("selector avoids database work when an alert has no eligible entity", async () => {
  const repository = new RecordingCandidateRepository([]);
  const selector = new IncidentCandidateSelector(repository);
  const result = await selector.select({ alert: alert() });

  assert.equal(result.selected, null);
  assert.equal(repository.input, null);
});

function alert(overrides: Partial<UnifiedRuleAlert> = {}): UnifiedRuleAlert {
  return {
    id: "11111111-1111-8111-8111-111111111111",
    type: "rule",
    orgId: ORG_ID,
    ruleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleName: "Failed Login",
    matchedCondition: "selection",
    severity: "high",
    weight: 0.8,
    tags: [],
    matchedEventIds: ["event-1"],
    timestamp: ALERT_TIME,
    entities: [],
    metadata: {},
    ...overrides,
  };
}

function alertWithEntities(): UnifiedRuleAlert {
  return alert({ entities: entitySet("user", "host") });
}

function entitySet(...types: Array<"user" | "host">): readonly IncidentEntity[] {
  return types.map((type) => ({
    type,
    value: type === "user" ? "root" : "web-01",
  }));
}

function incident(
  id: string,
  overrides: Partial<IncidentRecord> = {},
): IncidentRecord {
  return {
    id,
    title: "High - Failed Login",
    description: null,
    status: "open",
    severity: "high",
    riskScore: 70,
    source: "rule",
    scoreBreakdown: {},
    primaryEntity: "root",
    entityType: "user",
    entities: entitySet("user"),
    killChainStages: [],
    alertCount: 1,
    eventCount: 1,
    assignedTo: null,
    firstEventAt: new Date("2026-10-11T06:00:00.000Z"),
    lastEventAt: new Date("2026-10-11T06:10:00.000Z"),
    createdAt: new Date("2026-10-11T06:00:00.000Z"),
    updatedAt: new Date("2026-10-11T06:10:00.000Z"),
    resolvedAt: null,
    closedAt: null,
    orgId: ORG_ID,
    ...overrides,
  };
}

class RecordingCandidateRepository {
  public input: IncidentCorrelationCandidateInput | null = null;

  public constructor(private readonly candidates: readonly IncidentRecord[]) {}

  public async findOpenCandidates(
    input: IncidentCorrelationCandidateInput,
  ): Promise<readonly IncidentRecord[]> {
    this.input = input;
    return this.candidates;
  }
}
