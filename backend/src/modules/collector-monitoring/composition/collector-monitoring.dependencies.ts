import type { ICollectorStatusRepository } from "../../../database/index.js";
import { GetCollectorStatusUseCase } from "../application/get-collector-status.use-case.js";
import { CollectorMonitoringRepositoryAdapter } from "../infrastructure/collector-monitoring.repository.adapter.js";

export interface CreateCollectorMonitoringDependenciesInput {
  readonly collectorStatusRepository: Pick<
    ICollectorStatusRepository,
    "list"
  >;
}

export interface CollectorMonitoringDependencies {
  readonly getCollectorStatusUseCase: GetCollectorStatusUseCase;
}

export function createCollectorMonitoringDependencies(
  input: CreateCollectorMonitoringDependenciesInput,
): CollectorMonitoringDependencies {
  const repository = new CollectorMonitoringRepositoryAdapter(
    input.collectorStatusRepository,
  );

  return {
    getCollectorStatusUseCase: new GetCollectorStatusUseCase(repository),
  };
}

