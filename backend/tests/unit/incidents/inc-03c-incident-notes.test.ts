import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { CreateAuditLogInput } from "../../../src/database/repositories/audit/index.js";
import type { IncidentNoteRecord } from "../../../src/database/repositories/incident-notes/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import type { IUnitOfWork, TransactionOptions } from "../../../src/database/transactions/index.js";
import { AddIncidentNoteUseCase } from "../../../src/modules/incidents/application/add-incident-note.use-case.js";
import type {
  IncidentNoteCommandTransaction,
  IncidentNoteCommandUnitOfWork,
} from "../../../src/modules/incidents/domain/incident-note-command.contracts.js";
import { PostgresIncidentNoteCommandUnitOfWork } from "../../../src/modules/incidents/infrastructure/postgres-incident-note-command-unit-of-work.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const ACTOR_ID = "550e8400-e29b-41d4-a716-446655440001";
const ORG_ID = "org-alpha";
const NOW = new Date("2026-10-20T01:00:00.000Z");

test("creates a raw Markdown note and immutable audit atomically", async () => {
  const unit = new InMemoryNoteUnitOfWork(incident());
  const content = "**Confirmed** compromise.\n\n- Host isolated";
  const result = await new AddIncidentNoteUseCase(unit).execute(command(content));

  assert.equal(result?.incidentId, INCIDENT_ID);
  assert.equal(result?.authorId, ACTOR_ID);
  assert.equal(result?.authorName, "incident-analyst");
  assert.equal(result?.content, content);
  assert.equal(unit.notes.length, 1);
  assert.equal(unit.audit.length, 1);
  assert.equal(unit.audit[0]?.action, "incident_note_added");
  assert.equal(unit.audit[0]?.orgId, ORG_ID);
  assert.deepEqual(unit.audit[0]?.details, {
    noteId: result?.id,
    content,
  });
  assert.deepEqual(unit.audit[0]?.newState, {
    noteId: result?.id,
    authorId: ACTOR_ID,
  });
  assert.deepEqual(unit.lastLookup, { id: INCIDENT_ID, orgId: ORG_ID });
});

test("returns null without writing for a missing or cross-tenant incident", async () => {
  const unit = new InMemoryNoteUnitOfWork(null);
  const result = await new AddIncidentNoteUseCase(unit).execute(command("note"));
  assert.equal(result, null);
  assert.equal(unit.notes.length, 0);
  assert.equal(unit.audit.length, 0);
});

test("rolls the note back when immutable audit insertion fails", async () => {
  const unit = new InMemoryNoteUnitOfWork(incident());
  unit.failAudit = true;
  await assert.rejects(
    new AddIncidentNoteUseCase(unit).execute(command("rollback me")),
    /simulated audit failure/u,
  );
  assert.equal(unit.notes.length, 0);
  assert.equal(unit.audit.length, 0);
  assert.equal(unit.rollbackCount, 1);
});

test("does not audit when note persistence fails", async () => {
  const unit = new InMemoryNoteUnitOfWork(incident());
  unit.failNote = true;
  await assert.rejects(
    new AddIncidentNoteUseCase(unit).execute(command("cannot persist")),
    /simulated note failure/u,
  );
  assert.equal(unit.audit.length, 0);
});

test("serializes concurrent note commands on the incident row", async () => {
  const unit = new InMemoryNoteUnitOfWork(incident());
  const useCase = new AddIncidentNoteUseCase(unit);
  await Promise.all([
    useCase.execute(command("first")),
    useCase.execute(command("second")),
  ]);
  assert.deepEqual(unit.notes.map((note) => note.content), ["first", "second"]);
  assert.deepEqual(unit.audit.map((entry) => entry.details?.content), [
    "first",
    "second",
  ]);
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
  const adapter = new PostgresIncidentNoteCommandUnitOfWork(underlying);
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

test("INC-03C migration adds the audit action and database length guard", async () => {
  const migration = await readFile(
    `${process.cwd()}/migrations/postgres/20261020000100_inc_03c_incident_notes.js`,
    "utf8",
  );
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'incident_note_added'/u);
  assert.match(migration, /char_length\(content\) <= 10000/u);
  assert.match(migration, /config = \{ transaction: true \}/u);
});

function command(content: string) {
  return {
    incidentId: INCIDENT_ID,
    orgId: ORG_ID,
    content,
    actor: {
      id: ACTOR_ID,
      username: "incident-analyst",
      role: "soc_analyst" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function incident(): IncidentRecord {
  return {
    id: INCIDENT_ID,
    title: "HIGH — SSH brute force",
    description: null,
    status: "investigating",
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
    resolvedAt: null,
    closedAt: null,
    orgId: ORG_ID,
  };
}

class InMemoryNoteUnitOfWork implements IncidentNoteCommandUnitOfWork {
  public readonly notes: IncidentNoteRecord[] = [];
  public readonly audit: CreateAuditLogInput[] = [];
  public failNote = false;
  public failAudit = false;
  public rollbackCount = 0;
  public lastLookup: { id: string; orgId: string } | null = null;
  private readonly storedIncident: IncidentRecord | null;
  private queue: Promise<void> = Promise.resolve();

  public constructor(storedIncident: IncidentRecord | null) {
    this.storedIncident = storedIncident;
  }

  public execute<TResult>(
    operation: (transaction: IncidentNoteCommandTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const run = this.queue.then(async () => {
      const noteLength = this.notes.length;
      const auditLength = this.audit.length;
      try {
        return await operation(this.transaction());
      } catch (error) {
        this.notes.length = noteLength;
        this.audit.length = auditLength;
        this.rollbackCount += 1;
        throw error;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private transaction(): IncidentNoteCommandTransaction {
    return {
      incidents: {
        findByIdForUpdate: async (id, orgId) => {
          this.lastLookup = { id, orgId };
          return this.storedIncident?.id === id &&
              this.storedIncident.orgId === orgId
            ? this.storedIncident
            : null;
        },
      },
      notes: {
        create: async (input) => {
          if (this.failNote) throw new Error("simulated note failure");
          const note = {
            id: `00000000-0000-4000-8000-${String(this.notes.length + 1).padStart(12, "0")}`,
            incidentId: input.incidentId,
            authorId: input.authorId,
            content: input.content,
            createdAt: new Date(NOW.getTime() + this.notes.length),
            updatedAt: new Date(NOW.getTime() + this.notes.length),
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
