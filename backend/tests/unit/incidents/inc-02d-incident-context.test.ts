import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { GetIncidentContextUseCase } from "../../../src/modules/incidents/application/get-incident-context.use-case.js";
import type {
  IncidentContextRepositoryQuery,
  IncidentContextRepositoryResult,
} from "../../../src/modules/incidents/domain/incident-context.contracts.js";
import type { IncidentQueryRecord } from "../../../src/modules/incidents/domain/incident-query.contracts.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const NOW = new Date("2026-10-19T12:00:00.000Z");

test("builds 30-day tenant-scoped context for unique incident entities", async () => {
  const harness = createHarness();
  harness.incidents.result = incident([
    { type: "src_ip", value: "192.168.1.100" },
    { type: "host", value: "web-server-01" },
    { type: "src_ip", value: "192.168.1.100" },
  ]);
  harness.context.result = contextResult();

  const result = await harness.useCase.execute({
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
  });

  assert.deepEqual(result, contextResult());
  assert.deepEqual(harness.context.inputs, [
    {
      incidentId: INCIDENT_ID,
      orgId: "org-alpha",
      entities: [
        { type: "src_ip", value: "192.168.1.100" },
        { type: "host", value: "web-server-01" },
      ],
      historySince: new Date("2026-09-19T12:00:00.000Z"),
      previousIncidentLimit: 50,
    },
  ]);
});

test("missing and cross-tenant incidents do not query historical context", async () => {
  const harness = createHarness();
  harness.incidents.result = null;

  const result = await harness.useCase.execute({
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
  });

  assert.equal(result, null);
  assert.equal(harness.context.inputs.length, 0);
});

test("an incident without entities returns an empty context without extra SQL", async () => {
  const harness = createHarness();
  harness.incidents.result = incident([]);

  const result = await harness.useCase.execute({
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
  });

  assert.deepEqual(result, {
    previousIncidents: [],
    assets: [],
    entityHistory: {},
  });
  assert.equal(harness.context.inputs.length, 0);
});

test("INC-02D migration provides JSONB and tenant-aware asset lookup indexes", async () => {
  const source = await readFile(
    resolve(
      process.cwd(),
      "migrations/postgres/20261019000100_inc_02d_incident_context_indexes.js",
    ),
    "utf8",
  );

  assert.match(source, /USING GIN \(entities jsonb_path_ops\)/u);
  assert.match(source, /assets \(org_id, ip_address\)/u);
  assert.match(source, /assets \(org_id, lower\(hostname\)\)/u);
  assert.match(source, /config = \{ transaction: false \}/u);
});

function createHarness() {
  const incidents = {
    result: incident([]) as IncidentQueryRecord | null,
    async findById() {
      return this.result;
    },
  };
  const context = {
    result: {
      previousIncidents: [],
      assets: [],
      entityHistory: {},
    } as IncidentContextRepositoryResult,
    inputs: [] as IncidentContextRepositoryQuery[],
    async getContext(input: IncidentContextRepositoryQuery) {
      this.inputs.push(input);
      return this.result;
    },
  };

  return {
    incidents,
    context,
    useCase: new GetIncidentContextUseCase(incidents, context, {
      now: () => NOW,
    }),
  };
}

function contextResult(): IncidentContextRepositoryResult {
  return {
    previousIncidents: [
      {
        id: "00000000-0000-4000-8000-000000000502",
        title: "Earlier SSH activity",
        severity: "medium",
        status: "closed",
        createdAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    ],
    assets: [
      {
        name: "web-server-01",
        assetType: "server",
        ipAddress: "10.0.0.5",
        criticality: 0.9,
        owner: "DevOps Team",
        department: "Engineering",
        tags: ["production", "web"],
      },
    ],
    entityHistory: {
      "192.168.1.100": {
        firstSeenAt: new Date("2026-09-20T01:00:00.000Z"),
        incidentCount30d: 2,
        alertCount30d: 5,
      },
    },
  };
}

function incident(
  entities: IncidentQueryRecord["entities"],
): IncidentQueryRecord {
  return {
    id: INCIDENT_ID,
    title: "HIGH — SSH brute force",
    description: null,
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: entities[0]?.value ?? null,
    entityType: entities[0]?.type ?? null,
    entities,
    killChainStages: [],
    alertCount: 2,
    eventCount: 12,
    assignedTo: null,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-10-18T01:00:00.000Z"),
    updatedAt: new Date("2026-10-18T01:00:00.000Z"),
    resolvedAt: null,
    closedAt: null,
  };
}
