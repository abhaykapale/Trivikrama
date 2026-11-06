import type { RedisClient } from "../../../database/redis/client.js";
import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import { CreateRuleUseCase } from "../application/create-rule.use-case.js";
import { ChangeRuleStatusUseCase } from "../application/change-rule-status.use-case.js";
import { UpdateRuleUseCase } from "../application/update-rule.use-case.js";
import { ArchiveRuleUseCase } from "../application/archive-rule.use-case.js";
import { ImportRulesUseCase } from "../application/import-rules.use-case.js";
import {
  PostgresRuleCommandUnitOfWork,
  PostgresRuleCreationUnitOfWork,
} from "../infrastructure/postgres-rule-creation-unit-of-work.js";
import { RedisRuleReloadPublisher } from "../infrastructure/redis-rule-reload.publisher.js";

export interface RuleCommandDependencies {
  readonly createRuleUseCase: CreateRuleUseCase;
  readonly updateRuleUseCase: UpdateRuleUseCase;
  readonly enableRuleUseCase: ChangeRuleStatusUseCase;
  readonly disableRuleUseCase: ChangeRuleStatusUseCase;
  readonly archiveRuleUseCase: ArchiveRuleUseCase;
  readonly importRulesUseCase: ImportRulesUseCase;
}

export function createRuleCommandDependencies(
  unitOfWork: IUnitOfWork,
  redis: RedisClient,
): RuleCommandDependencies {
  const creationTransaction = new PostgresRuleCreationUnitOfWork(unitOfWork);
  const commandTransaction = new PostgresRuleCommandUnitOfWork(unitOfWork);
  const reloadSignals = new RedisRuleReloadPublisher(redis);
  return {
    createRuleUseCase: new CreateRuleUseCase({
      unitOfWork: creationTransaction,
      reloadSignals,
    }),
    updateRuleUseCase: new UpdateRuleUseCase({
      unitOfWork: commandTransaction,
      reloadSignals,
    }),
    enableRuleUseCase: new ChangeRuleStatusUseCase(
      { unitOfWork: commandTransaction, reloadSignals },
      "enable",
    ),
    disableRuleUseCase: new ChangeRuleStatusUseCase(
      { unitOfWork: commandTransaction, reloadSignals },
      "disable",
    ),
    archiveRuleUseCase: new ArchiveRuleUseCase({
      unitOfWork: commandTransaction,
      reloadSignals,
    }),
    importRulesUseCase: new ImportRulesUseCase({
      unitOfWork: creationTransaction,
      reloadSignals,
    }),
  };
}
