import type { IRuleRepository } from "../../../database/repositories/rules/rule.repository.js";
import type { RedisClient } from "../../../database/redis/client.js";
import { ReloadableOrganizationSigmaRuleEngine } from "../application/reloadable-organization-sigma-rule-engine.js";
import { PostgresActiveMatchRuleSource } from "../infrastructure/postgres-active-match-rule.source.js";
import { PostgresActiveCountRuleSource } from "../infrastructure/postgres-active-count-rule.source.js";
import { RedisCountWindowStore } from "../infrastructure/redis-count-window.store.js";

export interface CreateOrganizationRuleEngineOptions {
  readonly organizationId: string;
  readonly ruleRepository: Pick<IRuleRepository, "list">;
  readonly redisClient?: RedisClient;
  readonly countWindowKeyPrefix?: string;
}

export async function createOrganizationRuleEngine(
  options: CreateOrganizationRuleEngineOptions,
): Promise<ReloadableOrganizationSigmaRuleEngine> {
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: options.organizationId,
    source: new PostgresActiveMatchRuleSource(options.ruleRepository),
    ...(options.redisClient === undefined
      ? {}
      : {
          countSource: new PostgresActiveCountRuleSource(options.ruleRepository),
          countWindowStore: new RedisCountWindowStore(options.redisClient, {
            keyPrefix: options.countWindowKeyPrefix,
          }),
        }),
  });

  await engine.reloadRules();
  return engine;
}
