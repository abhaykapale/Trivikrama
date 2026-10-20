import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../../src/database/repositories/common/index.js";
import { PostgresIncidentRepository } from "../../../src/database/repositories/incidents/index.js";
import {
  normalizeIncidentEntities,
  normalizeIncidentEntity,
  prepareIncidentCorrelationCandidateInput,
  type IncidentEntity,
} from "../../../src/modules/incidents/index.js";

test("normalizes users and hostnames according to the incident design", () => {
  assert.deepEqual(
    normalizeIncidentEntity({ type: "user", value: " ROOT@LOCALHOST " }),
    { type: "user", value: "root" },
  );
  assert.deepEqual(
    normalizeIncidentEntity({ type: "host", value: "WEB-01.CORP.LOCAL" }),
    { type: "host", value: "web-01" },
  );
  assert.deepEqual(
    normalizeIncidentEntity({ type: "src_ip", value: "2001:DB8::10" }),
    { type: "src_ip", value: "2001:db8::10" },
  );
});

test("deduplicates normalized entities while preserving first-seen order", () => {
  const entities = normalizeIncidentEntities([
    { type: "user", value: "ROOT" },
    { type: "src_ip", value: "192.0.2.10" },
    { type: "user", value: "root@localhost" },
  ]);

  assert.deepEqual(entities, [
    { type: "user", value: "root" },
    { type: "src_ip", value: "192.0.2.10" },
  ]);
  assert.ok(Object.isFrozen(entities));
  assert.ok(Object.isFrozen(entities[0]));
});

test("prepares a tenant-safe candidate lookup with immutable defaults", () => {
  const activeAfter = new Date("2026-10-11T05:45:00.000Z");
  const prepared = prepareIncidentCorrelationCandidateInput({
    orgId: " tenant-a ",
    entities: [{ type: "host", value: "HOST-01.EXAMPLE.LOCAL" }],
    activeAfter,
  });

  activeAfter.setUTCFullYear(2030);

  assert.equal(prepared.orgId, "tenant-a");
  assert.equal(prepared.limit, 25);
  assert.equal(prepared.activeAfter.toISOString(), "2026-10-11T05:45:00.000Z");
  assert.deepEqual(prepared.entities, [{ type: "host", value: "host-01" }]);
  assert.ok(Object.isFrozen(prepared));
});

test("rejects invalid entity and candidate lookup inputs", () => {
  assert.throws(
    () => normalizeIncidentEntity({ type: "user", value: " " }),
    /1 to 255 characters/u,
  );
  assert.throws(
    () =>
      normalizeIncidentEntity({
        type: "unsupported" as IncidentEntity["type"],
        value: "value",
      }),
    /Unsupported incident entity type/u,
  );
  assert.throws(
    () =>
      prepareIncidentCorrelationCandidateInput({
        orgId: " ",
        entities: [],
        activeAfter: new Date(),
      }),
    /orgId/u,
  );
  assert.throws(
    () =>
      prepareIncidentCorrelationCandidateInput({
        orgId: "tenant-a",
        entities: [],
        activeAfter: new Date("invalid"),
      }),
    /valid date/u,
  );
  assert.throws(
    () =>
      prepareIncidentCorrelationCandidateInput({
        orgId: "tenant-a",
        entities: [],
        activeAfter: new Date(),
        limit: 101,
      }),
    /between 1 and 100/u,
  );
});

test("open-candidate persistence lookup enforces tenant, lifecycle, window, and entity filters", async () => {
  const query = new RecordingQuery();
  const database = (() => query) as unknown as QueryExecutor;
  const repository = new PostgresIncidentRepository(database);
  const activeAfter = new Date("2026-10-11T05:45:00.000Z");

  const records = await repository.findOpenCandidates({
    orgId: "tenant-a",
    entities: [
      { type: "user", value: "ROOT@LOCALHOST" },
      { type: "host", value: "WEB-01.CORP.LOCAL" },
    ],
    activeAfter,
    limit: 10,
  });

  assert.deepEqual(records, []);
  assert.deepEqual(query.calls, [
    ["select", "*"],
    ["where", "org_id", "tenant-a"],
    ["whereIn", "status", ["open", "investigating"]],
    ["whereNotNull", "last_event_at"],
    ["where", "last_event_at", ">=", activeAfter],
    ["entity", "user", "root"],
    ["entity", "host", "web-01"],
    ["orderBy", "last_event_at", "desc"],
    ["orderBy", "risk_score", "desc"],
    ["orderBy", "created_at", "asc"],
    ["orderBy", "id", "asc"],
    ["limit", 10],
  ]);
});

class RecordingQuery implements PromiseLike<readonly never[]> {
  public readonly calls: unknown[][] = [];

  public select(...args: unknown[]): this {
    return this.record("select", ...args);
  }

  public where(...args: unknown[]): this {
    return this.record("where", ...args);
  }

  public whereIn(...args: unknown[]): this {
    return this.record("whereIn", ...args);
  }

  public whereNotNull(...args: unknown[]): this {
    return this.record("whereNotNull", ...args);
  }

  public andWhere(callback: (builder: RecordingEntityGroup) => void): this {
    callback(new RecordingEntityGroup(this.calls));
    return this;
  }

  public orderBy(...args: unknown[]): this {
    return this.record("orderBy", ...args);
  }

  public limit(...args: unknown[]): this {
    return this.record("limit", ...args);
  }

  public then<TResult1 = readonly never[], TResult2 = never>(
    onfulfilled?: ((value: readonly never[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([] as readonly never[]).then(onfulfilled, onrejected);
  }

  private record(method: string, ...args: unknown[]): this {
    this.calls.push([method, ...args]);
    return this;
  }
}

class RecordingEntityGroup {
  public constructor(private readonly calls: unknown[][]) {}

  public orWhere(callback: (candidate: RecordingEntityCandidate) => void): this {
    const candidate = new RecordingEntityCandidate();
    callback(candidate);
    this.calls.push(["entity", candidate.type, candidate.value]);
    return this;
  }
}

class RecordingEntityCandidate {
  public type: unknown;
  public value: unknown;

  public where(column: string, value: unknown): this {
    if (column === "entity_type") this.type = value;
    if (column === "primary_entity") this.value = value;
    return this;
  }
}
