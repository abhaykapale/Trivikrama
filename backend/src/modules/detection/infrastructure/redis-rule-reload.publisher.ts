import { createHash } from "node:crypto";

import type { RedisClient } from "../../../database/redis/client.js";
import type {
  RuleReloadSignal,
  RuleReloadSignalPublisher,
} from "../domain/rule-command.contracts.js";

export const RULE_RELOAD_CHANNEL = "detection:rules:reload:v1";

export class RedisRuleReloadPublisher implements RuleReloadSignalPublisher {
  public constructor(
    private readonly redis: Pick<RedisClient, "incr" | "publish">,
  ) {}

  public async publish(signal: RuleReloadSignal): Promise<boolean> {
    const organizationId = requireNonBlank(signal.organizationId, "organizationId");
    const ruleId = requireNonBlank(signal.ruleId, "ruleId");

    try {
      const revision = await this.redis.incr(revisionKey(organizationId));
      await this.redis.publish(
        RULE_RELOAD_CHANNEL,
        JSON.stringify({
          version: 1,
          organizationId,
          ruleId,
          operation: signal.operation,
          revision,
        }),
      );
      return true;
    } catch {
      // PostgreSQL is authoritative. A worker restart performs a full reload,
      // so a transient Redis outage must not misreport a committed create as failed.
      return false;
    }
  }
}

function revisionKey(organizationId: string): string {
  const digest = createHash("sha256").update(organizationId, "utf8").digest("hex");
  return `detection:rules:revision:v1:${digest}`;
}

function requireNonBlank(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be blank.`);
  return normalized;
}
