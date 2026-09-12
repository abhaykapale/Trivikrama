import type { ICollectorStatusRepository } from "../../../database/index.js";
import { GetCollectorStatusUseCase } from "../application/get-collector-status.use-case.js";
import { BullMqProcessingQueueMonitor } from "../infrastructure/bullmq-processing-queue.monitor.js";
import { CollectorMonitoringRepositoryAdapter } from "../infrastructure/collector-monitoring.repository.adapter.js";
import { FilesystemQuarantineMonitor } from "../infrastructure/filesystem-quarantine.monitor.js";
import { HttpAiEngineHealthMonitor } from "../infrastructure/http-ai-engine-health.monitor.js";

export interface CreateCollectorMonitoringDependenciesInput {
  readonly collectorStatusRepository: Pick<
    ICollectorStatusRepository,
    "list"
  >;
  readonly redisUrl: string;
  readonly collectorHandoffRoot: string;
  readonly queueName?: string;
  readonly queuePrefix?: string;
  readonly aiEngineUrl: string;
  readonly aiTimeoutMs: number;
  readonly aiHealthRefreshIntervalMs?: number;
}

export interface CollectorMonitoringDependencies {
  readonly getCollectorStatusUseCase: GetCollectorStatusUseCase;
  close(): Promise<void>;
}

export function createCollectorMonitoringDependencies(
  input: CreateCollectorMonitoringDependenciesInput,
): CollectorMonitoringDependencies {
  const repository = new CollectorMonitoringRepositoryAdapter(
    input.collectorStatusRepository,
  );
  const queueMonitor = new BullMqProcessingQueueMonitor({
    redisUrl: input.redisUrl,
    queueName: input.queueName,
    prefix: input.queuePrefix,
  });
  const quarantineMonitor = new FilesystemQuarantineMonitor({
    handoffRoot: input.collectorHandoffRoot,
  });
  const aiEngineHealthMonitor = new HttpAiEngineHealthMonitor({
    baseUrl: input.aiEngineUrl,
    timeoutMs: input.aiTimeoutMs,
    refreshIntervalMs: input.aiHealthRefreshIntervalMs,
  });

  return {
    getCollectorStatusUseCase: new GetCollectorStatusUseCase(
      repository,
      queueMonitor,
      quarantineMonitor,
      aiEngineHealthMonitor,
    ),
    async close(): Promise<void> {
      await Promise.all([
        queueMonitor.close(),
        aiEngineHealthMonitor.close(),
      ]);
    },
  };
}
