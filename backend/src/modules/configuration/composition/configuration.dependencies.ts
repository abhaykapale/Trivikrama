import type { IConfigurationRepository } from "../../../database/repositories/configuration/configuration.repository.js";
import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import { ListConfigurationUseCase } from "../application/list-configuration.use-case.js";
import { UpdateConfigurationUseCase } from "../application/update-configuration.use-case.js";
import { PostgresConfigurationCommandUnitOfWork } from "../infrastructure/postgres-configuration-command-unit-of-work.js";

export interface ConfigurationDependencies {
  readonly listConfigurationUseCase: ListConfigurationUseCase;
  readonly updateConfigurationUseCase: UpdateConfigurationUseCase;
}

export function createConfigurationDependencies(configuration: IConfigurationRepository, unitOfWork: IUnitOfWork): ConfigurationDependencies {
  return {
    listConfigurationUseCase: new ListConfigurationUseCase(configuration),
    updateConfigurationUseCase: new UpdateConfigurationUseCase(new PostgresConfigurationCommandUnitOfWork(unitOfWork)),
  };
}
