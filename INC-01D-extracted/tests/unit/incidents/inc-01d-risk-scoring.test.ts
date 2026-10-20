import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssetRecord,
  IAssetRepository,
} from "../../../src/database/repositories/assets/index.js";
import {
  classifyIncidentRiskSeverity,
  DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION,
  IncidentRiskScorer,
  RepositoryAssetCriticalityResolver,
  type AssetCriticalityResolver,
  type IncidentRiskScoringConfiguration,
  type UnifiedAiAlert,
  type UnifiedRuleAlert,
} from "../../../src/modules/incidents/index.js";

const ORG_ID = "incident-test-org";

test("computes the five-factor score and an auditable breakdown", async () => {
  const scorer = new IncidentRiskScorer(resolver(0.9), {
    ...DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION,
    killChainEnabled: true,
  });
  const alerts = [
    ruleAlert(0.8),
    aiAlert(0.92),
    ...Array.from({ length: 10 }, (_, index) =>
      ruleAlert(0.3, `rule-extra-${index}`),
    ),
  ];

  const result = await scorer.score({
    incidentId: "incident-142",
    orgId: ORG_ID,
    alerts,
    primaryEntity: { type: "host", value: "WEB-01.EXAMPLE.LOCAL" },
    killChainStages: [
      "credential_access",
      "privilege_escalation",
      "credential_access",
    ],
  });

  assert.equal(result.riskScore, 80.67);
  assert.equal(result.severity, "critical");
  assert.equal(result.scoreBreakdown.factors.ruleWeight.value, 0.8);
  assert.equal(result.scoreBreakdown.factors.mlConfidence.value, 0.92);
  assert.equal(result.scoreBreakdown.factors.assetCriticality.value, 0.9);
  assert.equal(result.scoreBreakdown.factors.alertDensity.value, 0.6);
  assert.equal(result.scoreBreakdown.factors.killChainBonus.value, 2 / 3);
  assert.equal(result.scoreBreakdown.rawScore, 0.806667);
  assert.match(result.scoreBreakdown.formula, /= 80\.67$/u);
});

test("uses neutral defaults and zero kill-chain contribution when unavailable", async () => {
  const scorer = new IncidentRiskScorer(resolver(null));
  const result = await scorer.score({
    orgId: ORG_ID,
    alerts: [],
    primaryEntity: null,
    killChainStages: ["credential_access"],
  });

  assert.equal(result.riskScore, 37.5);
  assert.equal(result.severity, "low");
  assert.equal(
    result.scoreBreakdown.factors.ruleWeight.availability,
    "neutral_default",
  );
  assert.equal(
    result.scoreBreakdown.factors.mlConfidence.availability,
    "neutral_default",
  );
  assert.equal(
    result.scoreBreakdown.factors.assetCriticality.availability,
    "neutral_default",
  );
  assert.equal(result.scoreBreakdown.factors.killChainBonus.value, 0);
  assert.equal(
    result.scoreBreakdown.factors.killChainBonus.availability,
    "disabled",
  );
});

test("does not treat fallback AI output as trustworthy confidence", async () => {
  const scorer = new IncidentRiskScorer(resolver(null));
  const result = await scorer.score({
    orgId: ORG_ID,
    alerts: [{ ...aiAlert(0.99), metadata: { usedFallback: true } }],
    primaryEntity: { type: "user", value: "root" },
    killChainStages: [],
  });

  assert.equal(result.scoreBreakdown.factors.mlConfidence.value, 0.5);
  assert.equal(
    result.scoreBreakdown.factors.mlConfidence.availability,
    "neutral_default",
  );
  assert.equal(result.riskScore, 38.25);
});

test("classifies every inclusive severity boundary", () => {
  assert.equal(classifyIncidentRiskSeverity(80), "critical");
  assert.equal(classifyIncidentRiskSeverity(79.99), "high");
  assert.equal(classifyIncidentRiskSeverity(60), "high");
  assert.equal(classifyIncidentRiskSeverity(40), "medium");
  assert.equal(classifyIncidentRiskSeverity(20), "low");
  assert.equal(classifyIncidentRiskSeverity(19.99), "informational");
});

test("rejects unsafe configuration, duplicate alerts, and tenant crossing", async () => {
  const invalidWeights: IncidentRiskScoringConfiguration = {
    ...DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION,
    weights: {
      ...DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION.weights,
      rule: 0.4,
    },
  };
  assert.throws(
    () => new IncidentRiskScorer(resolver(null), invalidWeights),
    /sum to 1\.0/u,
  );

  const scorer = new IncidentRiskScorer(resolver(null));
  await assert.rejects(
    scorer.score({
      orgId: ORG_ID,
      alerts: [ruleAlert(0.8), ruleAlert(0.7)],
      primaryEntity: null,
      killChainStages: [],
    }),
    /Duplicate unified alert identity/u,
  );
  await assert.rejects(
    scorer.score({
      orgId: ORG_ID,
      alerts: [{ ...ruleAlert(0.8), orgId: "another-org" }],
      primaryEntity: null,
      killChainStages: [],
    }),
    /organization boundary/u,
  );
});

test("scores batches in input order and returns immutable results", async () => {
  const scorer = new IncidentRiskScorer(resolver(0.5));
  const results = await scorer.scoreBatch([
    {
      incidentId: "incident-a",
      orgId: ORG_ID,
      alerts: [ruleAlert(0.9)],
      primaryEntity: null,
      killChainStages: [],
    },
    {
      incidentId: "incident-b",
      orgId: ORG_ID,
      alerts: [aiAlert(0.8)],
      primaryEntity: null,
      killChainStages: [],
    },
  ]);

  assert.deepEqual(
    results.map((result) => result.incidentId),
    ["incident-a", "incident-b"],
  );
  assert.ok(Object.isFrozen(results));
  assert.ok(Object.isFrozen(results[0]?.scoreBreakdown));
});

test("asset adapter resolves only supported entities and preserves tenant scope", async () => {
  const calls: unknown[][] = [];
  const repository = {
    async findByHostname(hostname: string, orgId: string) {
      calls.push(["hostname", hostname, orgId]);
      return asset({ hostname, orgId, criticality: 0.85 });
    },
    async findByIpAddress(ipAddress: string, orgId: string) {
      calls.push(["ip", ipAddress, orgId]);
      return asset({ ipAddress, orgId, criticality: 0.75 });
    },
  } as IAssetRepository;
  const adapter = new RepositoryAssetCriticalityResolver(repository);

  assert.equal(
    await adapter.resolve({
      orgId: ORG_ID,
      entity: { type: "host", value: "web-01" },
    }),
    0.85,
  );
  assert.equal(
    await adapter.resolve({
      orgId: ORG_ID,
      entity: { type: "src_ip", value: "192.0.2.10" },
    }),
    0.75,
  );
  assert.equal(
    await adapter.resolve({
      orgId: ORG_ID,
      entity: { type: "user", value: "root" },
    }),
    null,
  );
  assert.deepEqual(calls, [
    ["hostname", "web-01", ORG_ID],
    ["ip", "192.0.2.10", ORG_ID],
  ]);
});

function resolver(value: number | null): AssetCriticalityResolver {
  return { async resolve() { return value; } };
}

function ruleAlert(weight: number, id = "rule-alert"): UnifiedRuleAlert {
  return {
    id,
    type: "rule",
    orgId: ORG_ID,
    ruleId: `rule-${id}`,
    ruleName: "Detection Rule",
    matchedCondition: "selection",
    severity: "high",
    weight,
    tags: [],
    matchedEventIds: [`event-${id}`],
    timestamp: new Date("2026-10-11T06:15:00.000Z"),
    entities: [],
    metadata: {},
  };
}

function aiAlert(anomalyScore: number): UnifiedAiAlert {
  return {
    id: "ai-alert",
    type: "ai",
    orgId: ORG_ID,
    modelName: "isolation_forest",
    modelVersion: "v1",
    anomalyScore,
    confidence: 0.95,
    severity: "critical",
    weight: anomalyScore,
    tags: [],
    matchedEventIds: ["event-ai"],
    timestamp: new Date("2026-10-11T06:15:00.000Z"),
    entities: [],
    metadata: { usedFallback: false },
  };
}

function asset(overrides: Partial<AssetRecord>): AssetRecord {
  return {
    id: "asset-1",
    name: "Web server",
    assetType: "server",
    ipAddress: null,
    hostname: null,
    criticality: 0.5,
    owner: null,
    department: null,
    tags: [],
    metadata: {},
    isActive: true,
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    updatedAt: new Date("2026-10-11T00:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}
