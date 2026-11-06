import type { MongoDbClient } from "../../../database/mongodb/client.js";
import type { QueryExecutor } from "../../../database/repositories/common/index.js";
import { DryRunRuleUseCase } from "../application/dry-run-rule.use-case.js";
import { ExportRulesUseCase } from "../application/export-rules.use-case.js";
import { MongoRuleDryRunEventRepository } from "../infrastructure/mongo-rule-dry-run-event.repository.js";
import { PostgresRuleQueryRepository } from "../infrastructure/postgres-rule-query.repository.js";

export interface RuleOperationalDependencies {
  readonly dryRunRuleUseCase: DryRunRuleUseCase;
  readonly exportRulesUseCase: ExportRulesUseCase;
}

export function createRuleOperationalDependencies(
  postgres: QueryExecutor,
  mongodb: MongoDbClient,
): RuleOperationalDependencies {
  const rules = new PostgresRuleQueryRepository(postgres);
  const events = new MongoRuleDryRunEventRepository(mongodb);
  return {
    dryRunRuleUseCase: new DryRunRuleUseCase({ rules, events }),
    exportRulesUseCase: new ExportRulesUseCase(rules),
  };
}
