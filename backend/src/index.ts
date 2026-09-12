export {
  authenticateRequest,
  requireAuthenticatedPrincipal,
} from "./modules/auth/http/auth.middleware.js";

export type { AuthenticateRequestDependencies } from "./modules/auth/http/auth.middleware.js";

export { createAuthRouter } from "./modules/auth/http/auth.routes.js";

export type { CreateAuthRouterDependencies } from "./modules/auth/http/auth.routes.js";

export type { Permission } from "./modules/auth/http/permissions.js";

export {
  requirePermission,
  requireRole,
} from "./modules/auth/http/rbac.middleware.js";


export {
  createUsersRouter,
  type CreateUsersRouterDependencies,
} from "./modules/users/http/index.js";

export {
    createConfiguredCollectorMessageVerifier,
    createCollectorMessageVerifier,
    CollectorTrustConfigurationError,
    CollectorVerificationError,
    isCollectorVerificationError,
} from "./modules/ingestion/index.js";

export type {
    CollectorVerificationRuntimeConfiguration,
    ICollectorMessageVerifier,
    VerifiedCollectorMessage,
} from "./modules/ingestion/index.js";

export {
    createConfiguredCollectorHeartbeatMonitor,
    CollectorHeartbeatError,
    isCollectorHeartbeatError,
} from "./modules/ingestion/index.js";

export type {
    CollectorHeartbeatMonitorRuntimeConfiguration,
    ConfiguredCollectorHeartbeatMonitor,
} from "./modules/ingestion/index.js";

export {
  BullMqProcessingQueueMonitor,
  CollectorMonitoringRepositoryAdapter,
  FilesystemQuarantineFileCatalog,
  FilesystemQuarantineMonitor,
  GetCollectorStatusUseCase,
  HttpAiEngineHealthMonitor,
  ListQuarantinedFilesUseCase,
  createCollectorMonitoringDependencies,
  createCollectorMonitoringRouter,
} from "./modules/collector-monitoring/index.js";

export type {
  AiEngineHealthSnapshot,
  AiEngineStatus,
  BullMqProcessingQueueMonitorConfiguration,
  CollectorMonitoringDependencies,
  CollectorStatusView,
  CreateCollectorMonitoringDependenciesInput,
  CreateCollectorMonitoringRouterDependencies,
  GetCollectorStatusInput,
  GetCollectorStatusResult,
  HttpAiEngineHealthMonitorConfiguration,
  HttpAiEngineHealthMonitorDependencies,
  IAiEngineHealthMonitor,
  FilesystemQuarantineMonitorConfiguration,
  FilesystemQuarantineFileCatalogConfiguration,
  ICollectorMonitoringRepository,
  IProcessingQueueMonitor,
  IQuarantineFileCatalog,
  IQuarantineMonitor,
  ListQuarantinedFileRecordsInput,
  ListQuarantinedFilesInput,
  ListQuarantinedFilesResult,
  MonitoredCollectorRecord,
  MonitoredCollectorStatus,
  ProcessingQueueStatusSnapshot,
  QuarantinedFileRecord,
  QuarantinedFileRecordPage,
  QuarantinedFileView,
  QuarantinePaginationView,
  QueueStatusView,
  QuarantineStatusSnapshot,
} from "./modules/collector-monitoring/index.js";
