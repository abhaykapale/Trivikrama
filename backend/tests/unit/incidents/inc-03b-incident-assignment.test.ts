import assert from "node:assert/strict";
import test from "node:test";

import type { CreateAuditLogInput } from "../../../src/database/repositories/audit/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import type { UserRecord } from "../../../src/database/repositories/users/index.js";
import type { IUnitOfWork, TransactionOptions } from "../../../src/database/transactions/index.js";
import {
  AssignIncidentUseCase,
  IncidentAssigneeNotAvailableError,
} from "../../../src/modules/incidents/application/assign-incident.use-case.js";
import type {
  IncidentAssignmentTransaction,
  IncidentAssignmentUnitOfWork,
} from "../../../src/modules/incidents/domain/incident-assignment.contracts.js";
import { PostgresIncidentAssignmentUnitOfWork } from "../../../src/modules/incidents/infrastructure/postgres-incident-assignment-unit-of-work.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000601";
const SECOND_ASSIGNEE_ID = "00000000-0000-4000-8000-000000000602";
const ORG_ID = "org-alpha";
const NOW = new Date("2026-10-20T00:00:00.000Z");

test("assigns an active same-organization user and writes immutable audit", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(record(), [user(ASSIGNEE_ID)]);
  const result = await new AssignIncidentUseCase(unit).execute(command(ASSIGNEE_ID));

  assert.equal(result?.assignedTo, ASSIGNEE_ID);
  assert.equal(unit.incident.assignedTo, ASSIGNEE_ID);
  assert.equal(unit.audit.length, 1);
  assert.equal(unit.audit[0]?.action, "incident_assign");
  assert.equal(unit.audit[0]?.orgId, ORG_ID);
  assert.deepEqual(unit.audit[0]?.previousState, { assignedTo: null });
  assert.deepEqual(unit.audit[0]?.newState, { assignedTo: ASSIGNEE_ID });
  assert.deepEqual(unit.audit[0]?.details, {
    previousAssigneeId: null,
    newAssigneeId: ASSIGNEE_ID,
    newAssigneeUsername: "assignee",
  });
  assert.deepEqual(unit.lastUserLookup, { id: ASSIGNEE_ID, orgId: ORG_ID });
  assert.deepEqual(unit.lastUpdate, { id: INCIDENT_ID, orgId: ORG_ID, assignedTo: ASSIGNEE_ID });
});

test("unassigns with null without looking up a user", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(record(ASSIGNEE_ID), []);
  const result = await new AssignIncidentUseCase(unit).execute(command(null));

  assert.equal(result?.assignedTo, null);
  assert.equal(unit.lastUserLookup, null);
  assert.equal(unit.audit.length, 1);
  assert.deepEqual(unit.audit[0]?.previousState, { assignedTo: ASSIGNEE_ID });
  assert.deepEqual(unit.audit[0]?.newState, { assignedTo: null });
});

test("rejects missing, inactive, and cross-tenant assignees without mutation", async () => {
  for (const availableUsers of [
    [],
    [user(ASSIGNEE_ID, { isActive: false })],
    [user(ASSIGNEE_ID, { orgId: "org-foreign" })],
  ]) {
    const unit = new InMemoryAssignmentUnitOfWork(record(), availableUsers);
    await assert.rejects(
      new AssignIncidentUseCase(unit).execute(command(ASSIGNEE_ID)),
      (error: unknown) =>
        error instanceof IncidentAssigneeNotAvailableError &&
        error.assigneeId === ASSIGNEE_ID,
    );
    assert.equal(unit.incident.assignedTo, null);
    assert.equal(unit.audit.length, 0);
    assert.equal(unit.lastUpdate, null);
  }
});

test("returns null for missing or cross-tenant incidents", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(null, [user(ASSIGNEE_ID)]);
  const result = await new AssignIncidentUseCase(unit).execute(command(ASSIGNEE_ID));
  assert.equal(result, null);
  assert.equal(unit.lastUserLookup, null);
  assert.equal(unit.audit.length, 0);
});

test("treats replaying an existing assignment as an idempotent no-op", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(record(ASSIGNEE_ID), [user(ASSIGNEE_ID)]);
  const result = await new AssignIncidentUseCase(unit).execute(command(ASSIGNEE_ID));
  assert.equal(result?.assignedTo, ASSIGNEE_ID);
  assert.equal(unit.audit.length, 0);
  assert.equal(unit.lastUpdate, null);
});

test("rolls assignment back when audit insertion fails", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(record(), [user(ASSIGNEE_ID)]);
  unit.failAudit = true;
  await assert.rejects(
    new AssignIncidentUseCase(unit).execute(command(ASSIGNEE_ID)),
    /simulated audit failure/u,
  );
  assert.equal(unit.incident.assignedTo, null);
  assert.equal(unit.audit.length, 0);
  assert.equal(unit.rollbackCount, 1);
});

test("serializes competing assignments and audits the committed state chain", async () => {
  const unit = new InMemoryAssignmentUnitOfWork(record(), [
    user(ASSIGNEE_ID),
    user(SECOND_ASSIGNEE_ID, { username: "second" }),
  ]);
  const useCase = new AssignIncidentUseCase(unit);
  await Promise.all([
    useCase.execute(command(ASSIGNEE_ID)),
    useCase.execute(command(SECOND_ASSIGNEE_ID)),
  ]);
  assert.equal(unit.incident.assignedTo, SECOND_ASSIGNEE_ID);
  assert.equal(unit.audit.length, 2);
  assert.deepEqual(unit.audit.map((entry) => entry.previousState), [
    { assignedTo: null },
    { assignedTo: ASSIGNEE_ID },
  ]);
});

test("PostgreSQL adapter uses bounded retrying SERIALIZABLE transactions", async () => {
  let observedOptions: TransactionOptions | undefined;
  const incidents = {};
  const users = {};
  const audit = {};
  const underlying = {
    async execute(operation, options) {
      observedOptions = options;
      return operation({
        transaction: {} as never,
        repositories: { incidents, users, audit } as never,
        attempt: 1,
      });
    },
  } satisfies IUnitOfWork;
  const adapter = new PostgresIncidentAssignmentUnitOfWork(underlying);
  const result = await adapter.execute(async (transaction) => {
    assert.equal(transaction.incidents, incidents);
    assert.equal(transaction.users, users);
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

function command(assignedTo: string | null) {
  return {
    incidentId: INCIDENT_ID,
    orgId: ORG_ID,
    assignedTo,
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "incident-operator",
      role: "security_engineer" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function record(assignedTo: string | null = null): IncidentRecord {
  return {
    id: INCIDENT_ID, title: "HIGH — SSH brute force", description: null,
    status: "open", severity: "high", riskScore: 78.5, source: "both",
    scoreBreakdown: {}, primaryEntity: "192.0.2.10", entityType: "src_ip",
    entities: [], killChainStages: [], alertCount: 2, eventCount: 12,
    assignedTo, firstEventAt: null, lastEventAt: null,
    createdAt: new Date("2026-10-19T20:00:00.000Z"),
    updatedAt: new Date("2026-10-19T20:00:00.000Z"),
    resolvedAt: null, closedAt: null, orgId: ORG_ID,
  };
}

function user(id: string, overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id, username: "assignee", email: `${id}@example.test`, passwordHash: "hash",
    role: "soc_analyst", displayName: "Assignee", isActive: true,
    lastLoginAt: null, failedLoginCount: 0, lockedUntil: null,
    createdAt: NOW, updatedAt: NOW, orgId: ORG_ID, ...overrides,
  };
}

class InMemoryAssignmentUnitOfWork implements IncidentAssignmentUnitOfWork {
  public incident: IncidentRecord;
  public readonly audit: CreateAuditLogInput[] = [];
  public failAudit = false;
  public rollbackCount = 0;
  public lastUserLookup: { id: string; orgId: string } | null = null;
  public lastUpdate: { id: string; orgId: string; assignedTo: string | null } | null = null;
  private readonly exists: boolean;
  private readonly users: UserRecord[];
  private queue: Promise<void> = Promise.resolve();

  public constructor(initial: IncidentRecord | null, users: UserRecord[]) {
    this.exists = initial !== null;
    this.incident = initial ?? record();
    this.users = users;
  }

  public execute<TResult>(operation: (transaction: IncidentAssignmentTransaction) => Promise<TResult>): Promise<TResult> {
    const run = this.queue.then(async () => {
      const snapshot = structuredClone(this.incident);
      const auditLength = this.audit.length;
      try { return await operation(this.transaction()); }
      catch (error) {
        this.incident = snapshot;
        this.audit.length = auditLength;
        this.rollbackCount += 1;
        throw error;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private transaction(): IncidentAssignmentTransaction {
    return {
      incidents: {
        findByIdForUpdate: async (id, orgId) =>
          this.exists && id === this.incident.id && orgId === this.incident.orgId
            ? this.incident : null,
        assignForOrg: async (id, orgId, assignedTo) => {
          this.lastUpdate = { id, orgId, assignedTo };
          if (!this.exists || id !== this.incident.id || orgId !== this.incident.orgId) return null;
          this.incident = { ...this.incident, assignedTo, updatedAt: NOW };
          return this.incident;
        },
      },
      users: {
        findByIdAndOrg: async (id, orgId) => {
          this.lastUserLookup = { id, orgId };
          return this.users.find((entry) => entry.id === id && entry.orgId === orgId) ?? null;
        },
      },
      audit: {
        create: async (input) => {
          if (this.failAudit) throw new Error("simulated audit failure");
          this.audit.push(input);
          return { id: "00000000-0000-4000-8000-000000000701", action: input.action,
            actorId: input.actorId ?? null, actorUsername: input.actorUsername ?? null,
            actorRole: input.actorRole ?? null, ipAddress: input.ipAddress ?? null,
            targetType: input.targetType ?? null, targetId: input.targetId ?? null,
            targetName: input.targetName ?? null, details: input.details ?? {},
            previousState: input.previousState ?? null, newState: input.newState ?? null,
            createdAt: NOW, orgId: input.orgId ?? "default" };
        },
      },
    };
  }
}
