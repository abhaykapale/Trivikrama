import type { IRuleRepository } from "../../../database/repositories/rules/rule.repository.js";
import { ReloadableOrganizationSigmaRuleEngine } from "../application/reloadable-organization-sigma-rule-engine.js";
import { PostgresActiveMatchRuleSource } from "../infrastructure/postgres-active-match-rule.source.js";

export interface CreateOrganizationRuleEngineOptions {
  readonly organizationId: string;
  readonly ruleRepository: Pick<IRuleRepository, "list">;
}

export async function createOrganizationRuleEngine(
  options: CreateOrganizationRuleEngineOptions,
): Promise<ReloadableOrganizationSigmaRuleEngine> {
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: options.organizationId,
    source: new PostgresActiveMatchRuleSource(options.ruleRepository),
  });

  await engine.reloadRules();
  return engine;
}
