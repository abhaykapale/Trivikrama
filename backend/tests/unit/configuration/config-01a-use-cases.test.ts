import assert from "node:assert/strict";
import test from "node:test";
import type { ConfigurationRecord } from "../../../src/database/repositories/configuration/configuration.repository.js";
import { validateConfigurationValue } from "../../../src/modules/configuration/application/configuration-value.policy.js";
import { ListConfigurationUseCase } from "../../../src/modules/configuration/application/list-configuration.use-case.js";
import { UpdateConfigurationUseCase } from "../../../src/modules/configuration/application/update-configuration.use-case.js";
import { ConfigurationKeyNotManagedError, InvalidConfigurationValueError, type ConfigurationCommandTransaction, type ConfigurationCommandUnitOfWork } from "../../../src/modules/configuration/domain/configuration.contracts.js";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const ACTOR = { id: "550e8400-e29b-41d4-a716-446655440001", username: "engineer", role: "security_engineer" as const, ipAddress: "10.0.0.5", orgId: "tenant-a" };

test("CONFIG-01A lists only through the non-sensitive bounded repository filter", async () => {
  const calls: unknown[] = [];
  const result = await new ListConfigurationUseCase({ async list(filters) {
    calls.push(filters);
    return { items: [record("ai.anomaly_threshold", 0.65)], limit: 100, offset: 0, hasMore: false };
  } }).execute();
  assert.deepEqual(calls, [{ includeSensitive: false, limit: 100, offset: 0 }]);
  assert.deepEqual(result.data[0], { key: "ai.anomaly_threshold", value: 0.65, description: "description", isSensitive: false, updatedAt: NOW });
  assert.equal("id" in result.data[0]!, false);
  assert.equal("updatedBy" in result.data[0]!, false);
});

test("CONFIG-01A validates documented key-specific value domains", () => {
  assert.equal(validateConfigurationValue("ai.anomaly_threshold", 0.7), 0.7);
  assert.equal(validateConfigurationValue("correlation.extend_on_alert", true), true);
  assert.equal(validateConfigurationValue("retention.cleanup_schedule", "0 2 * * *"), "0 2 * * *");
  assert.throws(() => validateConfigurationValue("ai.anomaly_threshold", 1.1), InvalidConfigurationValueError);
  assert.throws(() => validateConfigurationValue("ai.batch_size", 0), InvalidConfigurationValueError);
  assert.throws(() => validateConfigurationValue("ai.base_url", "file:///etc/passwd"), InvalidConfigurationValueError);
  assert.throws(() => validateConfigurationValue("unknown.key", true), ConfigurationKeyNotManagedError);
});

test("CONFIG-01A locks, updates, and audits a configuration change atomically", async () => {
  const transaction = new MemoryConfigurationUnitOfWork(record("ai.anomaly_threshold", 0.65));
  const result = await new UpdateConfigurationUseCase(transaction).execute({ key: "ai.anomaly_threshold", value: 0.7, actor: ACTOR });
  assert.deepEqual(result, { key: "ai.anomaly_threshold", value: 0.7, previousValue: 0.65, updatedAt: NOW, updatedBy: ACTOR.id });
  assert.equal(transaction.locked, 1);
  assert.equal(transaction.updates, 1);
  assert.equal(transaction.audits.length, 1);
  assert.deepEqual(transaction.audits[0], {
    action: "config_change", actorId: ACTOR.id, actorUsername: ACTOR.username, actorRole: ACTOR.role,
    ipAddress: ACTOR.ipAddress, targetType: "config", targetId: "ai.anomaly_threshold", targetName: "description",
    details: { key: "ai.anomaly_threshold" }, previousState: { value: 0.65 }, newState: { value: 0.7 }, orgId: "tenant-a",
  });
});

test("CONFIG-01A treats replay as a no-op and conceals sensitive or absent keys", async () => {
  const replay = new MemoryConfigurationUnitOfWork(record("ai.anomaly_threshold", 0.65));
  assert.ok(await new UpdateConfigurationUseCase(replay).execute({ key: "ai.anomaly_threshold", value: 0.65, actor: ACTOR }));
  assert.equal(replay.updates, 0); assert.equal(replay.audits.length, 0);
  const sensitive = new MemoryConfigurationUnitOfWork({ ...record("ai.anomaly_threshold", 0.65), isSensitive: true });
  assert.equal(await new UpdateConfigurationUseCase(sensitive).execute({ key: "ai.anomaly_threshold", value: 0.7, actor: ACTOR }), null);
  assert.equal(sensitive.updates, 0); assert.equal(sensitive.audits.length, 0);
  const missing = new MemoryConfigurationUnitOfWork(null);
  assert.equal(await new UpdateConfigurationUseCase(missing).execute({ key: "ai.anomaly_threshold", value: 0.7, actor: ACTOR }), null);
});

class MemoryConfigurationUnitOfWork implements ConfigurationCommandUnitOfWork {
  public locked = 0; public updates = 0; public readonly audits: unknown[] = [];
  public constructor(private current: ConfigurationRecord | null) {}
  public async execute<TResult>(operation: (transaction: ConfigurationCommandTransaction) => Promise<TResult>): Promise<TResult> {
    return operation({
      configuration: {
        findByKeyForUpdate: async <TValue = unknown>() => { this.locked += 1; return this.current as ConfigurationRecord<TValue> | null; },
        updateValue: async (_key, input) => { this.updates += 1; this.current = this.current === null ? null : { ...this.current, value: input.value, updatedBy: input.updatedBy ?? null, updatedAt: NOW }; return this.current; },
      },
      audit: { create: async (input) => { this.audits.push(input); return { id: "audit-1", action: input.action, actorId: input.actorId ?? null, actorUsername: input.actorUsername ?? null, actorRole: input.actorRole ?? null, ipAddress: input.ipAddress ?? null, targetType: input.targetType ?? null, targetId: input.targetId ?? null, targetName: input.targetName ?? null, details: input.details ?? {}, previousState: input.previousState ?? null, newState: input.newState ?? null, createdAt: NOW, orgId: input.orgId ?? "default" }; } },
    });
  }
}

function record(key: string, value: unknown): ConfigurationRecord { return { id: "550e8400-e29b-41d4-a716-446655440090", key, value, description: "description", isSensitive: false, updatedBy: null, createdAt: NOW, updatedAt: NOW }; }
