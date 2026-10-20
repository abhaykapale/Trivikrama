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
  FilesystemQuarantineFileRequeuer,
  FilesystemQuarantineMonitor,
  GetCollectorStatusUseCase,
  HttpAiEngineHealthMonitor,
  ListQuarantinedFilesUseCase,
  QuarantineRetryError,
  RetryQuarantinedFileUseCase,
  isQuarantineRetryError,
  createCollectorMonitoringDependencies,
  createCollectorMonitoringRouter,
} from "./modules/collector-monitoring/index.js";

export {
  createDeterministicAiAlertId,
  createUnifiedAlertDedupKey,
  normalizeIncidentEntities,
  normalizeIncidentEntity,
  prepareIncidentCorrelationCandidateInput,
  UnifiedAlertDeduplicator,
  UnifiedAlertEntityExtractor,
  UnifiedAlertMerger,
  IncidentCandidateRanker,
  IncidentCandidateSelector,
  DEFAULT_INCIDENT_CORRELATION_CONFIGURATION,
} from "./modules/incidents/index.js";

export type {
  AiResultSource,
  AlertEntityEventSource,
  CreateDeterministicAiAlertIdInput,
  DeduplicateUnifiedAlertsResult,
  IncidentCorrelationCandidateInput,
  IncidentCorrelationConfiguration,
  IncidentEntity,
  IncidentEntityType,
  IncidentKillChainStage,
  IncidentScoreBreakdown,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  MergeAlertSourcesInput,
  MergeAlertSourcesResult,
  EnrichUnifiedAlertsWithEntitiesInput,
  EnrichUnifiedAlertsWithEntitiesResult,
  IncidentCandidateRepositoryPort,
  RankedIncidentCandidate,
  RankIncidentCandidatesInput,
  RankIncidentCandidatesResult,
  SelectIncidentCandidateInput,
  RuleAlertSource,
  UnifiedAiAlert,
  UnifiedAlert,
  UnifiedRuleAlert,
} from "./modules/incidents/index.js";

export {
  AiCircuitBreaker,
  DetectAndPersistAiResultsService,
  HttpAiClient,
} from "./modules/analysis/index.js";

export type {
  AiCircuitState,
  AiClientStats,
  AiDetectionPrediction,
  AiDetectionResult,
  AiDetectionStats,
  AiShapExplanation,
  AiShapFeatureContribution,
  DetectAndPersistAiResultsDependencies,
  DetectAndPersistAiResultsResult,
  HttpAiClientConfiguration,
  HttpAiClientDependencies,
  IAIClient,
} from "./modules/analysis/index.js";

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
  FilesystemQuarantineFileRequeuerConfiguration,
  ICollectorMonitoringRepository,
  IProcessingQueueMonitor,
  IQuarantineFileCatalog,
  IQuarantineFileRequeuer,
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
  QuarantineRetryErrorCode,
  QueueStatusView,
  RequeueQuarantinedFileResult,
  RetryQuarantinedFileInput,
  RetryQuarantinedFileResult,
  QuarantineStatusSnapshot,
} from "./modules/collector-monitoring/index.js";
