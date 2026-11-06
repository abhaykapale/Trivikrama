import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { IUnitOfWork } from "../../../src/database/transactions/transaction.types.js";
import { RuleRepositoryUniqueConflictError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { PostgresRuleCreationUnitOfWork } from "../../../src/modules/detection/infrastructure/postgres-rule-creation-unit-of-work.js";
import { RedisRuleReloadPublisher, RULE_RELOAD_CHANNEL } from "../../../src/modules/detection/infrastructure/redis-rule-reload.publisher.js";
import { RedisRuleReloadSubscriber } from "../../../src/modules/detection/infrastructure/redis-rule-reload.subscriber.js";

test("RULE-02B migration enforces tenant-unique Sigma IDs and case-insensitive names", async () => {
  const source = await readFile(
    resolve(process.cwd(), "migrations/postgres/20261023000100_rule_02b_creation_integrity.js"),
    "utf8",
  );
  assert.match(source, /sigma_id/u);
  assert.match(source, /UNIQUE INDEX uq_rules_org_sigma_id/u);
  assert.match(source, /UNIQUE INDEX uq_rules_org_name_ci/u);
  assert.match(source, /\(org_id, lower\(name\)\)/u);
});

test("RULE-02B PostgreSQL adapter requests a retrying SERIALIZABLE transaction", async () => {
  let options: unknown;
  const base: IUnitOfWork = {
    async execute(operation, receivedOptions) {
      options = receivedOptions;
      return operation({ repositories: { rules: {} as never, audit: {} as never } as never, transaction: {} as never, attempt: 1 });
    },
  };
  const unit = new PostgresRuleCreationUnitOfWork(base);
  await unit.execute(async (transaction) => {
    assert.ok(transaction.rules);
    assert.ok(transaction.audit);
  });
  assert.deepEqual(options, {
    isolationLevel: "serializable",
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
    retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
  });
});

test("RULE-02B maps PostgreSQL uniqueness conflicts without leaking SQL details", async () => {
  const base: IUnitOfWork = {
    async execute() {
      throw { code: "23505", constraint: "uq_rules_org_sigma_id", detail: "sensitive" };
    },
  };
  await assert.rejects(
    () => new PostgresRuleCreationUnitOfWork(base).execute(async () => undefined),
    (error: unknown) =>
      error instanceof RuleRepositoryUniqueConflictError &&
      error.constraint === "uq_rules_org_sigma_id" &&
      !error.message.includes("sensitive"),
  );
});

test("RULE-02B publishes a versioned reload signal and degrades safely on Redis outage", async () => {
  const calls: Array<{ channel: string; payload: string }> = [];
  const publisher = new RedisRuleReloadPublisher({
    async incr(key: string) {
      assert.match(key, /^detection:rules:revision:v1:[a-f0-9]{64}$/u);
      assert.equal(key.includes("org-secret"), false);
      return 4;
    },
    async publish(channel: string, payload: string) {
      calls.push({ channel, payload });
      return 1;
    },
  } as never);
  assert.equal(await publisher.publish({ organizationId: "org-secret", ruleId: "rule-db-id", operation: "created" }), true);
  assert.equal(calls[0]?.channel, RULE_RELOAD_CHANNEL);
  assert.deepEqual(JSON.parse(calls[0]!.payload), {
    version: 1,
    organizationId: "org-secret",
    ruleId: "rule-db-id",
    operation: "created",
    revision: 4,
  });

  const unavailable = new RedisRuleReloadPublisher({
    async incr() { throw new Error("offline"); },
    async publish() { return 0; },
  } as never);
  assert.equal(await unavailable.publish({ organizationId: "org-secret", ruleId: "rule-db-id", operation: "created" }), false);
});

test("RULE-02B reload subscriber ignores malformed and cross-tenant signals", async () => {
  const listeners = new Map<string, (...args: string[]) => void>();
  const subscriber = {
    status: "ready",
    on(event: string, listener: (...args: string[]) => void) {
      listeners.set(event, listener);
      return this;
    },
    off(event: string) {
      listeners.delete(event);
      return this;
    },
    async subscribe(channel: string) {
      assert.equal(channel, RULE_RELOAD_CHANNEL);
      return 1;
    },
    async unsubscribe() { return 0; },
    async quit() { this.status = "end"; return "OK"; },
    disconnect() { this.status = "end"; },
  };
  let reloads = 0;
  const reloadSubscriber = new RedisRuleReloadSubscriber(
    { duplicate: () => subscriber } as never,
    "tenant-a",
    { async reloadRules() { reloads += 1; } },
  );
  await reloadSubscriber.start();

  const message = listeners.get("message");
  assert.ok(message);
  message(RULE_RELOAD_CHANNEL, "not-json");
  message(RULE_RELOAD_CHANNEL, JSON.stringify({ version: 1, organizationId: "tenant-b", ruleId: "r1", revision: 1 }));
  message(RULE_RELOAD_CHANNEL, JSON.stringify({ version: 1, organizationId: "tenant-a", ruleId: "r2", revision: 2 }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reloads, 1);
  await reloadSubscriber.close();
  assert.equal(subscriber.status, "end");
});
