export type {
  ICollectorMonitoringRepository,
  IProcessingQueueMonitor,
  IQuarantineMonitor,
  MonitoredCollectorRecord,
  MonitoredCollectorStatus,
  ProcessingQueueStatusSnapshot,
  QuarantineStatusSnapshot,
} from "./domain/collector-monitoring.contracts.js";

export { GetCollectorStatusUseCase } from "./application/get-collector-status.use-case.js";
export type {
  CollectorStatusView,
  GetCollectorStatusInput,
  GetCollectorStatusResult,
  QueueStatusView,
} from "./application/get-collector-status.use-case.js";

export { CollectorMonitoringRepositoryAdapter } from "./infrastructure/collector-monitoring.repository.adapter.js";
export { BullMqProcessingQueueMonitor } from "./infrastructure/bullmq-processing-queue.monitor.js";
export type { BullMqProcessingQueueMonitorConfiguration } from "./infrastructure/bullmq-processing-queue.monitor.js";
export { FilesystemQuarantineMonitor } from "./infrastructure/filesystem-quarantine.monitor.js";
export type { FilesystemQuarantineMonitorConfiguration } from "./infrastructure/filesystem-quarantine.monitor.js";

export { createCollectorMonitoringDependencies } from "./composition/collector-monitoring.dependencies.js";
export type {
  CollectorMonitoringDependencies,
  CreateCollectorMonitoringDependenciesInput,
} from "./composition/collector-monitoring.dependencies.js";

export { createCollectorMonitoringRouter } from "./http/collector-monitoring.routes.js";
export type { CreateCollectorMonitoringRouterDependencies } from "./http/collector-monitoring.routes.js";
