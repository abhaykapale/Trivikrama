import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { CreateAuditLogInput } from "../../../src/database/repositories/audit/index.js";
import type { IncidentNoteRecord } from "../../../src/database/repositories/incident-notes/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import type { IUnitOfWork, TransactionOptions } from "../../../src/database/transactions/index.js";
import { ResolveIncidentUseCase } from "../../../src/modules/incidents/application/resolve-incident.use-case.js";
import { InvalidIncidentStatusTransitionError } from "../../../src/modules/incidents/application/transition-incident-status.use-case.js";
import {
  INCIDENT_RESOLUTIONS,
  type IncidentResolution,
  type IncidentResolutionTransaction,
  type IncidentResolutionUnitOfWork,
} from "../../../src/modules/incidents/domain/incident-resolution.contracts.js";
import type { IncidentStatus } from "../../../src/modules/incidents/domain/incident.contracts.js";
import { PostgresIncidentResolutionUnitOfWork } from "../../../src/modules/incidents/infrastructure/postgres-incident-resolution-unit-of-work.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const ACTOR_ID = "550e8400-e29b-41d4-a716-446655440001";
const ORG_ID = "org-alpha";
const NOW = new Date("2026-10-20T02:00:00.000Z");

for (const resolution of INCIDENT_RESOLUTIONS) {
  test(`resolves an investigating incident as ${resolution}`, async () => {
    const unit = new InMemoryResolutionUnitOfWork(incident("investigating"));
    const result = await createUseCase(unit).execute(command(resolution));

    assert.equal(result?.status, "resolved");
    assert.equal(result?.resolution, resolution);
    assert.equal(result?.resolvedAt.toISOString(), NOW.toISOString());
    assert.equal(unit.incident.status, "resolved");
    assert.equal(unit.incident.resolvedAt?.toISOString(), NOW.toISOString());
    assert.equal(unit.audit.length, 1);
    assert.equal(unit.audit[0]?.action, "incident_resolve");
    assert.deepEqual(unit.audit[0]?.details, {
      resolution,
      noteId: null,
      note: null,
    });
    assert.deepEqual(unit.audit[0]?.previousState, {
      status: "investigating",
      resolvedAt: null,
    });
    assert.deepEqual(unit.audit[0]?.newState, {
      status: "resolved",
      resolution,
      resolvedAt: NOW.toISOString(),
    });
  });
}

test("stores the optional resolution note without creating a second audit event", async () => {
  const unit = new InMemoryResolutionUnitOfWork(incident("investigating"));
  const result = await createUseCase(unit).execute(
    command("tp_mitigated", "**Host reimaged.** Credentials rotated."),
  );

  assert.equal(result?.status, "resolved");
  assert.equal(unit.notes.length, 1);
  assert.equal(unit.notes[0]?.authorId, ACTOR_ID);
  assert.equal(unit.audit.length, 1);
  assert.deepEqual(unit.audit[0]?.details, {
    resolution: "tp_mitigated",
    noteId: unit.notes[0]?.id,
    note: "**Host reimaged.** Credentials rotated.",
  });
});

test("rejects resolution from every non-investigating state", async () => {
  for (const status of ["open", "resolved", "closed"] as const) {
    const unit = new InMemoryResolutionUnitOfWork(incident(status));
    await assert.rejects(
      createUseCase(unit).execute(command("informational")),
      (error: unknown) =>
        error instanceof InvalidIncidentStatusTransitionError &&
        error.currentStatus === status &&
        error.requestedStatus === "resolved",
    );
    assert.equal(unit.incident.status, status);
    assert.equal(unit.notes.length, 0);
    assert.equal(unit.audit.length, 0);
  }
});

test("returns null without writes for a missing or cross-tenant incident", async () => {
  const unit = new InMemoryResolutionUnitOfWork(null);
  const result = await createUseCase(unit).execute(command("tp_accepted"));
  assert.equal(result, null);
  assert.equal(unit.notes.length, 0);
  assert.equal(unit.audit.length, 0);
});

test("rolls status and optional note back when audit insertion fails", async () => {
  const unit = new InMemoryResolutionUnitOfWork(incident("investigating"));
  unit.failAudit = true;
  await assert.rejects(
    createUseCase(unit).execute(command("fp_known", "Known scanner.")),
    /simulated audit failure/u,
  );
  assert.equal(unit.incident.status, "investigating");
  assert.equal(unit.incident.resolvedAt, null);
  assert.equal(unit.notes.length, 0);
  assert.equal(unit.audit.length, 0);
  assert.equal(unit.rollbackCount, 1);
});

test("rolls status back when optional note insertion fails", async () => {
  const unit = new InMemoryResolutionUnitOfWork(incident("investigating"));
  unit.failNote = true;
  await assert.rejects(
    createUseCase(unit).execute(command("duplicate", "Merged elsewhere.")),
    /simulated note failure/u,
  );
  assert.equal(unit.incident.status, "investigating");
  assert.equal(unit.audit.length, 0);
});

test("serializes competing resolutions so only one can commit", async () => {
  const unit = new InMemoryResolutionUnitOfWork(incident("investigating"));
  const useCase = createUseCase(unit);
  const settled = await Promise.allSettled([
    useCase.execute(command("tp_mitigated")),
    useCase.execute(command("fp_known")),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
  assert.equal(unit.audit.length, 1);
  assert.equal(unit.incident.status, "resolved");
});

test("PostgreSQL adapter uses bounded retrying SERIALIZABLE transactions", async () => {
  let observedOptions: TransactionOptions | undefined;
  const incidents = {};
  const incidentNotes = {};
  const audit = {};
  const underlying = {
    async execute(operation, options) {
      observedOptions = options;
      return operation({
        transaction: {} as never,
        repositories: { incidents, incidentNotes, audit } as never,
        attempt: 1,
      });
    },
  } satisfies IUnitOfWork;
  const adapter = new PostgresIncidentResolutionUnitOfWork(underlying);
  const result = await adapter.execute(async (transaction) => {
    assert.equal(transaction.incidents, incidents);
    assert.equal(transaction.notes, incidentNotes);
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

test("INC-03D migration and timeline support reasoned resolution", async () => {
  const migration = await readFile(
    `${process.cwd()}/migrations/postgres/20261020000200_inc_03d_incident_resolution.js`,
    "utf8",
  );
  const timeline = await readFile(
    `${process.cwd()}/src/modules/incidents/infrastructure/postgres-incident-timeline.repository.ts`,
    "utf8",
  );
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'incident_resolve'/u);
  assert.match(migration, /config = \{ transaction: true \}/u);
  assert.match(timeline, /WHEN 'incident_resolve' THEN 'status_change'/u);
  assert.match(timeline, /WHEN 'incident_resolve' THEN log\.details ->> 'note'/u);
});

function createUseCase(unit: IncidentResolutionUnitOfWork) {
  return new ResolveIncidentUseCase(unit, { now: () => NOW });
}

function command(resolution: IncidentResolution, note?: string) {
  return {
    incidentId: INCIDENT_ID,
    orgId: ORG_ID,
    resolution,
    ...(note === undefined ? {} : { note }),
    actor: {
      id: ACTOR_ID,
      username: "incident-analyst",
      role: "soc_analyst" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function incident(status: IncidentStatus): IncidentRecord {
  const resolvedAt = status === "resolved" || status === "closed"
    ? new Date("2026-10-20T01:00:00.000Z")
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
    entities: [],
    killChainStages: [],
    alertCount: 2,
    eventCount: 12,
    assignedTo: ACTOR_ID,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt,
    closedAt: status === "closed" ? NOW : null,
    orgId: ORG_ID,
  };
}

class InMemoryResolutionUnitOfWork implements IncidentResolutionUnitOfWork {
  public incident: IncidentRecord;
  public readonly notes: IncidentNoteRecord[] = [];
  public readonly audit: CreateAuditLogInput[] = [];
  public failNote = false;
  public failAudit = false;
  public rollbackCount = 0;
  private readonly exists: boolean;
  private queue: Promise<void> = Promise.resolve();

  public constructor(initial: IncidentRecord | null) {
    this.exists = initial !== null;
    this.incident = initial ?? incident("investigating");
  }

  public execute<TResult>(
    operation: (transaction: IncidentResolutionTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const run = this.queue.then(async () => {
      const incidentSnapshot = structuredClone(this.incident);
      const noteLength = this.notes.length;
      const auditLength = this.audit.length;
      try {
        return await operation(this.transaction());
      } catch (error) {
        this.incident = incidentSnapshot;
        this.notes.length = noteLength;
        this.audit.length = auditLength;
        this.rollbackCount += 1;
        throw error;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private transaction(): IncidentResolutionTransaction {
    return {
      incidents: {
        findByIdForUpdate: async (id, orgId) =>
          this.exists && id === this.incident.id && orgId === this.incident.orgId
            ? this.incident
            : null,
        transitionStatusForOrg: async (id, orgId, input) => {
          if (!this.exists || id !== this.incident.id || orgId !== this.incident.orgId) {
            return null;
          }
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
      notes: {
        create: async (input) => {
          if (this.failNote) throw new Error("simulated note failure");
          const note = {
            id: "00000000-0000-4000-8000-000000000901",
            incidentId: input.incidentId,
            authorId: input.authorId,
            content: input.content,
            createdAt: NOW,
            updatedAt: NOW,
          };
          this.notes.push(note);
          return note;
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
