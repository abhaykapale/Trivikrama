import assert from "node:assert/strict";
import test from "node:test";

import type { CreateAuditLogInput } from "../../../src/database/repositories/audit/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import type {
  IUnitOfWork,
  TransactionOptions,
} from "../../../src/database/transactions/index.js";
import {
  InvalidIncidentStatusTransitionError,
  TransitionIncidentStatusUseCase,
} from "../../../src/modules/incidents/application/transition-incident-status.use-case.js";
import type {
  IncidentStatusTransaction,
  IncidentStatusUnitOfWork,
} from "../../../src/modules/incidents/domain/incident-status.contracts.js";
import type { IncidentStatus } from "../../../src/modules/incidents/domain/incident.contracts.js";
import { PostgresIncidentStatusUnitOfWork } from "../../../src/modules/incidents/infrastructure/postgres-incident-status-unit-of-work.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const ORG_ID = "org-alpha";
const NOW = new Date("2026-10-20T00:00:00.000Z");

const allowedTransitions = [
  ["open", "investigating"],
  ["open", "closed"],
  ["investigating", "resolved"],
  ["investigating", "open"],
  ["resolved", "closed"],
  ["resolved", "investigating"],
] as const satisfies ReadonlyArray<readonly [IncidentStatus, IncidentStatus]>;

for (const [from, to] of allowedTransitions) {
  test(`allows ${from} -> ${to} and writes one audit record`, async () => {
    const unitOfWork = new InMemoryIncidentStatusUnitOfWork(record(from));
    const useCase = createUseCase(unitOfWork);

    const result = await useCase.execute(command(to));

    assert.equal(result?.id, INCIDENT_ID);
    assert.equal(result?.status, to);
    assert.equal(unitOfWork.incident.status, to);
    assert.equal(unitOfWork.audit.length, 1);
    assert.deepEqual(unitOfWork.audit[0]?.details, {
      field: "status",
      previousValue: from,
      newValue: to,
    });
    assert.equal(unitOfWork.audit[0]?.orgId, ORG_ID);
    assert.equal(unitOfWork.lastLookup?.orgId, ORG_ID);
    assert.equal(unitOfWork.lastUpdate?.orgId, ORG_ID);

    if (to === "resolved") {
      assert.equal(unitOfWork.incident.resolvedAt?.toISOString(), NOW.toISOString());
      assert.equal(unitOfWork.incident.closedAt, null);
    } else if (to === "closed") {
      assert.equal(unitOfWork.incident.closedAt?.toISOString(), NOW.toISOString());
    } else {
      assert.equal(unitOfWork.incident.resolvedAt, null);
      assert.equal(unitOfWork.incident.closedAt, null);
    }
  });
}

test("rejects undocumented transitions without updating or auditing", async () => {
  for (const [from, to] of [
    ["closed", "investigating"],
    ["open", "resolved"],
    ["investigating", "closed"],
    ["resolved", "open"],
    ["open", "open"],
  ] as const satisfies ReadonlyArray<readonly [IncidentStatus, IncidentStatus]>) {
    const unitOfWork = new InMemoryIncidentStatusUnitOfWork(record(from));
    const useCase = createUseCase(unitOfWork);

    await assert.rejects(
      useCase.execute(command(to)),
      (error: unknown) =>
        error instanceof InvalidIncidentStatusTransitionError &&
        error.currentStatus === from &&
        error.requestedStatus === to,
    );
    assert.equal(unitOfWork.incident.status, from);
    assert.equal(unitOfWork.audit.length, 0);
  }
});

test("returns null without leaking a missing or cross-tenant incident", async () => {
  const unitOfWork = new InMemoryIncidentStatusUnitOfWork(null);
  const result = await createUseCase(unitOfWork).execute(command("investigating"));

  assert.equal(result, null);
  assert.equal(unitOfWork.audit.length, 0);
  assert.equal(unitOfWork.lastUpdate, null);
});

test("rolls the status update back when immutable audit insertion fails", async () => {
  const unitOfWork = new InMemoryIncidentStatusUnitOfWork(record("open"));
  unitOfWork.failAudit = true;

  await assert.rejects(
    createUseCase(unitOfWork).execute(command("investigating")),
    /simulated audit failure/u,
  );

  assert.equal(unitOfWork.incident.status, "open");
  assert.equal(unitOfWork.audit.length, 0);
  assert.equal(unitOfWork.rollbackCount, 1);
});

test("serializes competing transitions so stale state cannot be committed", async () => {
  const unitOfWork = new InMemoryIncidentStatusUnitOfWork(record("open"));
  const useCase = createUseCase(unitOfWork);

  const settled = await Promise.allSettled([
    useCase.execute(command("investigating")),
    useCase.execute(command("investigating")),
  ]);

  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
  assert.equal(unitOfWork.incident.status, "investigating");
  assert.equal(unitOfWork.audit.length, 1);
});

test("PostgreSQL adapter uses bounded retrying SERIALIZABLE transactions", async () => {
  let observedOptions: TransactionOptions | undefined;
  const incidents = {};
  const audit = {};
  const underlying = {
    async execute(operation, options) {
      observedOptions = options;
      return operation({
        transaction: {} as never,
        repositories: { incidents, audit } as never,
        attempt: 1,
      });
    },
  } satisfies IUnitOfWork;
  const adapter = new PostgresIncidentStatusUnitOfWork(underlying);

  const result = await adapter.execute(async (transaction) => {
    assert.equal(transaction.incidents, incidents);
    assert.equal(transaction.audit, audit);
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(observedOptions, {
    isolationLevel: "serializable",
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
    retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
  });
});

function createUseCase(unitOfWork: IncidentStatusUnitOfWork) {
  return new TransitionIncidentStatusUseCase(unitOfWork, { now: () => NOW });
}

function command(status: IncidentStatus) {
  return {
    incidentId: INCIDENT_ID,
    orgId: ORG_ID,
    status,
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "incident-analyst",
      role: "soc_analyst" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function record(status: IncidentStatus): IncidentRecord {
  const resolvedAt = status === "resolved" || status === "closed"
    ? new Date("2026-10-19T23:00:00.000Z")
    : null;
  const closedAt = status === "closed"
    ? new Date("2026-10-19T23:30:00.000Z")
    : null;
  return {
    id: INCIDENT_ID,
    title: "HIGH — SSH brute force",
    description: null,
    status,
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "192.0.2.10",
    entityType: "src_ip",
    entities: [{ type: "src_ip", value: "192.0.2.10" }],
    killChainStages: [],
    alertCount: 2,
    eventCount: 12,
    assignedTo: null,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-10-19T20:00:00.000Z"),
    updatedAt: new Date("2026-10-19T20:00:00.000Z"),
    resolvedAt,
    closedAt,
    orgId: ORG_ID,
  };
}

class InMemoryIncidentStatusUnitOfWork implements IncidentStatusUnitOfWork {
  public incident: IncidentRecord;
  public readonly audit: CreateAuditLogInput[] = [];
  public failAudit = false;
  public rollbackCount = 0;
  public lastLookup: { incidentId: string; orgId: string } | null = null;
  public lastUpdate: { incidentId: string; orgId: string } | null = null;
  private exists: boolean;
  private queue: Promise<void> = Promise.resolve();

  public constructor(initial: IncidentRecord | null) {
    this.exists = initial !== null;
    this.incident = initial ?? record("open");
  }

  public execute<TResult>(
    operation: (transaction: IncidentStatusTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const run = this.queue.then(async () => {
      const snapshot = structuredClone(this.incident);
      const auditLength = this.audit.length;
      try {
        return await operation(this.transaction());
      } catch (error) {
        this.incident = snapshot;
        this.audit.length = auditLength;
        this.rollbackCount += 1;
        throw error;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private transaction(): IncidentStatusTransaction {
    return {
      incidents: {
        findByIdForUpdate: async (incidentId, orgId) => {
          this.lastLookup = { incidentId, orgId };
          return this.exists &&
            incidentId === this.incident.id &&
            orgId === this.incident.orgId
            ? this.incident
            : null;
        },
        transitionStatusForOrg: async (incidentId, orgId, input) => {
          this.lastUpdate = { incidentId, orgId };
          if (
            !this.exists ||
            incidentId !== this.incident.id ||
            orgId !== this.incident.orgId
          ) return null;
          this.incident = {
            ...this.incident,
            status: input.status,
            resolvedAt: input.resolvedAt ?? null,
            closedAt: input.closedAt ?? null,
            updatedAt: NOW,
          };
          return this.incident;
        },
      },
      audit: {
        create: async (input) => {
          if (this.failAudit) throw new Error("simulated audit failure");
          this.audit.push(input);
          return {
            id: "00000000-0000-4000-8000-000000000701",
            action: input.action,
            actorId: input.actorId ?? null,
            actorUsername: input.actorUsername ?? null,
            actorRole: input.actorRole ?? null,
            ipAddress: input.ipAddress ?? null,
            targetType: input.targetType ?? null,
            targetId: input.targetId ?? null,
            targetName: input.targetName ?? null,
            details: input.details ?? {},
            previousState: input.previousState ?? null,
            newState: input.newState ?? null,
            createdAt: NOW,
            orgId: input.orgId ?? "default",
          };
        },
      },
    };
  }
}
