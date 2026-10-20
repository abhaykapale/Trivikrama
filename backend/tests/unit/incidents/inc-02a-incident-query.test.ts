import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GetIncidentDetailUseCase } from "../../../src/modules/incidents/application/get-incident-detail.use-case.js";
import { ListIncidentsUseCase } from "../../../src/modules/incidents/application/list-incidents.use-case.js";
import type {
  GetIncidentQuery,
  IIncidentQueryRepository,
  IncidentQueryPage,
  IncidentQueryRecord,
  ListIncidentsQuery,
} from "../../../src/modules/incidents/domain/incident-query.contracts.js";

test("ListIncidentsUseCase returns API pagination metadata", async () => {
  const repository = new FakeIncidentQueryRepository();
  repository.listResult = {
    items: [incidentRecord()],
    total: 26,
  };
  const useCase = new ListIncidentsUseCase(repository);
  const input: ListIncidentsQuery = {
    orgId: "org-alpha",
    page: 2,
    limit: 10,
    sort: "createdAt",
    order: "desc",
  };

  const result = await useCase.execute(input);

  assert.deepEqual(repository.listInputs, [input]);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 10,
    total: 26,
    totalPages: 3,
    hasNext: true,
    hasPrev: true,
  });
});

test("ListIncidentsUseCase handles an empty result without a phantom page", async () => {
  const repository = new FakeIncidentQueryRepository();
  const useCase = new ListIncidentsUseCase(repository);

  const result = await useCase.execute({
    orgId: "org-alpha",
    page: 1,
    limit: 25,
    sort: "createdAt",
    order: "desc",
  });

  assert.deepEqual(result, {
    data: [],
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
  });
});

test("GetIncidentDetailUseCase preserves the tenant-scoped lookup input", async () => {
  const repository = new FakeIncidentQueryRepository();
  repository.findResult = incidentRecord();
  const useCase = new GetIncidentDetailUseCase(repository);
  const input = {
    incidentId: "00000000-0000-4000-8000-000000000501",
    orgId: "org-alpha",
  };

  const result = await useCase.execute(input);

  assert.equal(result?.id, input.incidentId);
  assert.deepEqual(repository.findInputs, [input]);
});

test("INC-02A migration provides tenant-sort and trigram query indexes", async () => {
  const migration = await readFile(
    `${process.cwd()}/migrations/postgres/20261018000100_inc_02a_incident_query_indexes.js`,
    "utf8",
  );

  assert.match(migration, /\(org_id, created_at DESC, id DESC\)/u);
  assert.match(migration, /\(org_id, risk_score DESC, id DESC\)/u);
  assert.match(migration, /\(org_id, severity DESC, id DESC\)/u);
  assert.match(migration, /title gin_trgm_ops/u);
  assert.match(migration, /description gin_trgm_ops/u);
  assert.match(migration, /transaction: false/u);
});

class FakeIncidentQueryRepository implements IIncidentQueryRepository {
  public readonly listInputs: ListIncidentsQuery[] = [];
  public readonly findInputs: GetIncidentQuery[] = [];
  public listResult: IncidentQueryPage = { items: [], total: 0 };
  public findResult: IncidentQueryRecord | null = null;

  public async list(input: ListIncidentsQuery): Promise<IncidentQueryPage> {
    this.listInputs.push(input);
    return this.listResult;
  }

  public async findById(
    input: GetIncidentQuery,
  ): Promise<IncidentQueryRecord | null> {
    this.findInputs.push(input);
    return this.findResult;
  }
}

function incidentRecord(): IncidentQueryRecord {
  return {
    id: "00000000-0000-4000-8000-000000000501",
    title: "HIGH — SSH brute force",
    description: "Repeated failed logins.",
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "192.168.1.100",
    entityType: "src_ip",
    entities: [{ type: "src_ip", value: "192.168.1.100" }],
    killChainStages: ["credential_access"],
    alertCount: 2,
    eventCount: 12,
    assignedTo: null,
    firstEventAt: new Date("2026-07-26T05:10:00.000Z"),
    lastEventAt: new Date("2026-07-26T05:20:00.000Z"),
    createdAt: new Date("2026-07-26T05:10:00.000Z"),
    updatedAt: new Date("2026-07-26T05:20:00.000Z"),
    resolvedAt: null,
    closedAt: null,
  };
}
