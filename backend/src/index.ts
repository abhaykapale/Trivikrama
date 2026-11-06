export {
  authenticateRequest,
  requireAuthenticatedPrincipal,
} from "./modules/auth/http/auth.middleware.js";

export type { AuthenticateRequestDependencies } from "./modules/auth/http/auth.middleware.js";

export { createAuthRouter } from "./modules/auth/http/auth.routes.js";

export type { CreateAuthRouterDependencies } from "./modules/auth/http/auth.routes.js";

export type { Permission } from "./modules/auth/http/permissions.js";

export {
  createAuditQueryDependencies,
  createAuditQueryRouter,
  ListAuditLogsUseCase,
  PostgresAuditQueryRepository,
} from "./modules/audit/index.js";
export type {
  AuditLogInvestigationView,
  AuditPaginationView,
  AuditQueryAction,
  AuditQueryDependencies,
  AuditQuerySortField,
  AuditQuerySortOrder,
  CreateAuditQueryRouterDependencies,
  IAuditQueryRepository,
  ListAuditLogsInput,
  ListAuditLogsResult,
} from "./modules/audit/index.js";

export {
  createConfigurationDependencies,
  createConfigurationRouter,
  ListConfigurationUseCase,
  PostgresConfigurationCommandUnitOfWork,
  UpdateConfigurationUseCase,
  validateConfigurationValue,
} from "./modules/configuration/index.js";
export {
  createRealtimeDependencies,
  NodeWebSocketGateway,
  RedisRealtimeSubscriber,
  TenantConnectionHub,
  WebSocketUpgradeAuthenticator,
} from "./modules/realtime/index.js";
export type {
  RealtimeConnection,
  RealtimeDependencies,
  RealtimeNotification,
  RealtimePrincipal,
} from "./modules/realtime/index.js";
export type {
  ConfigurationDependencies,
  ConfigurationView,
  CreateConfigurationRouterDependencies,
  ListConfigurationResult,
  UpdateConfigurationCommand,
  UpdateConfigurationResult,
} from "./modules/configuration/index.js";

export {
  requirePermission,
  requireRole,
} from "./modules/auth/http/rbac.middleware.js";

export {
  createAssetDependencies,
  createAssetRouter,
  CreateAssetUseCase,
  DeactivateAssetUseCase,
  GetAssetUseCase,
  ListAssetsUseCase,
  PostgresAssetCommandUnitOfWork,
  UpdateAssetUseCase,
} from "./modules/assets/index.js";

export type {
  AssetDependencies,
  AssetDetailView,
  AssetPaginationView,
  AssetType,
  AssetView,
  CreateAssetRouterDependencies,
  ListAssetsInput,
  ListAssetsResult,
} from "./modules/assets/index.js";


export {
  createUsersRouter,
  type CreateUsersRouterDependencies,
} from "./modules/users/http/index.js";

export {
  createDashboardDependencies,
  createDashboardRouter,
  GetDashboardSourceBreakdownUseCase,
  GetDashboardSummaryUseCase,
  GetDashboardTimelineUseCase,
  GetDashboardTopAssetsUseCase,
  MongoDashboardEventRepository,
  PostgresDashboardRepository,
} from "./modules/dashboard/index.js";
export type {
  CreateDashboardRouterDependencies,
  DashboardDependencies,
  DashboardRange,
  DashboardInterval,
  DashboardRequest,
  DashboardTimelineRequest,
  DashboardTopAssetsRequest,
} from "./modules/dashboard/index.js";

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
  IncidentRiskScorer,
  RepositoryAssetCriticalityResolver,
  classifyIncidentRiskSeverity,
  DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION,
  TransactionalIncidentCorrelator,
  PostgresIncidentCorrelationUnitOfWork,
  createIncidentNotification,
  assertSameIncidentNotification,
  IncidentNotificationDispatcher,
  DEFAULT_INCIDENT_NOTIFICATION_DISPATCHER_CONFIGURATION,
  RedisIncidentNotificationPublisher,
  IncidentNotificationDispatcherRunner,
  createIncidentQueryDependencies,
  createIncidentCommandDependencies,
  createIncidentQueryRouter,
  GetIncidentDetailUseCase,
  GetIncidentTimelineUseCase,
  GetIncidentContextUseCase,
  TransitionIncidentStatusUseCase,
  InvalidIncidentStatusTransitionError,
  AssignIncidentUseCase,
  IncidentAssigneeNotAvailableError,
  AddIncidentNoteUseCase,
  ResolveIncidentUseCase,
  INCIDENT_RESOLUTIONS,
  ListIncidentAlertsUseCase,
  ListIncidentEventsUseCase,
  ListIncidentsUseCase,
  PostgresIncidentQueryRepository,
  PostgresIncidentTimelineRepository,
  PostgresIncidentEvidenceQueryRepository,
  PostgresIncidentContextRepository,
  PostgresIncidentStatusUnitOfWork,
  PostgresIncidentAssignmentUnitOfWork,
  PostgresIncidentNoteCommandUnitOfWork,
  PostgresIncidentResolutionUnitOfWork,
} from "./modules/incidents/index.js";

export {
  formatSystemProof,
  GenerateSystemProofService,
  RepositorySystemProofDataSource,
} from "./modules/system-proof/index.js";

export {
  createEventQueryDependencies,
  createEventQueryRouter,
  ExportEventsUseCase,
  GetEventDetailUseCase,
  MongoEventInvestigationRepository,
  SearchEventsUseCase,
} from "./modules/events/index.js";
export {
  createRuleQueryDependencies,
} from "./modules/detection/composition/rule-query.dependencies.js";
export { createRuleCommandDependencies } from "./modules/detection/composition/rule-command.dependencies.js";
export { createRuleOperationalDependencies } from "./modules/detection/composition/rule-operational.dependencies.js";
export { createRuleQueryRouter } from "./modules/detection/http/rule-query.routes.js";
export { GetRuleDetailUseCase } from "./modules/detection/application/get-rule-detail.use-case.js";
export { ListRulesUseCase } from "./modules/detection/application/list-rules.use-case.js";
export { PostgresRuleQueryRepository } from "./modules/detection/infrastructure/postgres-rule-query.repository.js";
export { CreateRuleUseCase } from "./modules/detection/application/create-rule.use-case.js";
export { UpdateRuleUseCase } from "./modules/detection/application/update-rule.use-case.js";
export { ChangeRuleStatusUseCase } from "./modules/detection/application/change-rule-status.use-case.js";
export { ArchiveRuleUseCase } from "./modules/detection/application/archive-rule.use-case.js";
export { ImportRulesUseCase } from "./modules/detection/application/import-rules.use-case.js";
export { DryRunRuleUseCase } from "./modules/detection/application/dry-run-rule.use-case.js";
export { ExportRulesUseCase } from "./modules/detection/application/export-rules.use-case.js";
export { validateSigmaRuleYaml } from "./modules/detection/application/validate-sigma-rule.js";
export type {
  GetRuleDetailQuery,
  IRuleQueryRepository,
  ListRulesQuery,
  ListRulesResult,
  RuleDetailView,
  RuleListItemView,
  RulePaginationView,
  RuleQueryPage,
  RuleQueryRecord,
  RuleQuerySortField,
  RuleQuerySortOrder,
} from "./modules/detection/domain/rule-query.contracts.js";
export type { CreateRuleQueryRouterDependencies } from "./modules/detection/http/rule-query.routes.js";
export type { RuleQueryDependencies } from "./modules/detection/composition/rule-query.dependencies.js";
export type { RuleCommandDependencies } from "./modules/detection/composition/rule-command.dependencies.js";
export type { RuleOperationalDependencies } from "./modules/detection/composition/rule-operational.dependencies.js";
export type {
  ArchiveRuleCommand,
  ArchiveRuleResult,
  ChangeRuleStatusCommand,
  ChangeRuleStatusResult,
  CreateRuleCommand,
  CreateRuleResult,
  ImportRulesCommand,
  ImportRulesResult,
  UpdateRuleCommand,
  UpdateRuleResult,
} from "./modules/detection/domain/rule-command.contracts.js";
export type {
  ExportRulesInput,
  ExportRulesResult,
  RuleDryRunInput,
  RuleDryRunResult,
} from "./modules/detection/domain/rule-operational.contracts.js";
export type {
  CreateEventQueryRouterDependencies,
  EventAiAnalysisView,
  EventDetailView,
  EventInvestigationView,
  EventPaginationView,
  EventQueryDependencies,
  EventQuerySortField,
  EventQuerySortOrder,
  EventRepositoryPage,
  EventRepositorySearchQuery,
  EventSearchInput,
  ExportEventsInput,
  ExportEventsResult,
  GetEventDetailInput,
  IEventInvestigationRepository,
  SearchEventsResult,
} from "./modules/events/index.js";
export type {
  GenerateSystemProofInput,
  SystemProofDataSource,
  SystemProofReport,
  SystemProofStage,
  SystemProofStageStatus,
} from "./modules/system-proof/index.js";

export type {
  AiResultSource,
  AlertEntityEventSource,
  AssetCriticalityResolver,
  CreateDeterministicAiAlertIdInput,
  DeduplicateUnifiedAlertsResult,
  IncidentCorrelationCandidateInput,
  IncidentCorrelationConfiguration,
  IncidentRiskFactorBreakdown,
  IncidentRiskScoreBreakdown,
  IncidentRiskScoreInput,
  IncidentRiskScoreResult,
  IncidentRiskScoringConfiguration,
  IncidentRiskWeights,
  IncidentSeverityThresholds,
  RiskFactorAvailability,
  CorrelateIncidentAlertsInput,
  CorrelateIncidentAlertsResult,
  IncidentCorrelationEventSource,
  IncidentCorrelationTransaction,
  IncidentCorrelationUnitOfWork,
  TransactionalIncidentCorrelatorDependencies,
  CreateIncidentNotificationInput,
  DispatchIncidentNotificationsResult,
  IncidentNotificationDispatcherConfiguration,
  IncidentNotificationDispatcherDependencies,
  IncidentNotificationPublishResult,
  IncidentNotificationPublisher,
  RedisIncidentNotificationPublisherOptions,
  RedisScriptExecutor,
  IncidentNotificationDispatcherLogger,
  IncidentNotificationDispatcherRunnerOptions,
  CreateIncidentQueryRouterDependencies,
  GetIncidentQuery,
  GetIncidentTimelineQuery,
  GetIncidentTimelineResult,
  GetIncidentContextQuery,
  GetIncidentContextResult,
  IIncidentQueryRepository,
  IIncidentTimelineRepository,
  IIncidentContextRepository,
  IIncidentEvidenceQueryRepository,
  IncidentPaginationView,
  IncidentQueryDependencies,
  IncidentCommandDependencies,
  IncidentQueryPage,
  IncidentQueryRecord,
  IncidentQuerySortField,
  IncidentQuerySortOrder,
  IncidentTimelineActionEntry,
  IncidentTimelineAlertEntry,
  IncidentTimelineEntry,
  IncidentTimelineEntryType,
  IncidentTimelineEventEntry,
  IncidentTimelinePage,
  IncidentTimelineStoredEntry,
  IncidentAlertQueryPage,
  IncidentAlertView,
  IncidentEventLinkQueryPage,
  IncidentEventLinkView,
  IncidentNormalizedEventView,
  IncidentAssetContextView,
  IncidentContextRepositoryQuery,
  IncidentContextRepositoryResult,
  IncidentEntityHistoryView,
  PreviousIncidentContextView,
  IncidentStatusActor,
  IncidentStatusTransaction,
  IncidentStatusUnitOfWork,
  TransitionIncidentStatusCommand,
  TransitionIncidentStatusResult,
  IncidentAssignmentActor,
  IncidentAssignmentTransaction,
  IncidentAssignmentUnitOfWork,
  AssignIncidentCommand,
  AssignIncidentResult,
  IncidentNoteActor,
  IncidentNoteCommandTransaction,
  IncidentNoteCommandUnitOfWork,
  AddIncidentNoteCommand,
  AddIncidentNoteResult,
  IncidentResolution,
  IncidentResolutionActor,
  IncidentResolutionTransaction,
  IncidentResolutionUnitOfWork,
  ResolveIncidentCommand,
  ResolveIncidentResult,
  ListIncidentAlertsQuery,
  ListIncidentAlertsResult,
  ListIncidentEventsQuery,
  ListIncidentEventsResult,
  ListIncidentsQuery,
  ListIncidentsResult,
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
