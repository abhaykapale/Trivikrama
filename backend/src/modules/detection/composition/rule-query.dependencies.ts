import type { QueryExecutor } from "../../../database/repositories/common/index.js";
import { GetRuleDetailUseCase } from "../application/get-rule-detail.use-case.js";
import { ListRulesUseCase } from "../application/list-rules.use-case.js";
import { PostgresRuleQueryRepository } from "../infrastructure/postgres-rule-query.repository.js";

export interface RuleQueryDependencies {
  readonly listRulesUseCase: ListRulesUseCase;
  readonly getRuleDetailUseCase: GetRuleDetailUseCase;
}

export function createRuleQueryDependencies(
  postgres: QueryExecutor,
): RuleQueryDependencies {
  const repository = new PostgresRuleQueryRepository(postgres);
  return {
    listRulesUseCase: new ListRulesUseCase(repository),
    getRuleDetailUseCase: new GetRuleDetailUseCase(repository),
  };
}
