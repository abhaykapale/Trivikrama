// -----------------------------------------------------------------------------
// Public Collector contract types
// -----------------------------------------------------------------------------

export type {
    CollectorAdapterType,
    CollectorContractVersion,
    CollectorEnvelope,
    CollectorEvent,
    CollectorEventBatch,
    CollectorEventSource,
    CollectorHeartbeat,
    CollectorHeartbeatMetrics,
    CollectorHeartbeatStatus,
    CollectorInputRejectionCode,
    CollectorIntegrity,
    CollectorIntegrityAlgorithm,
    CollectorMappingIdentity,
    CollectorMessage,
    CollectorMessageType,
    CollectorRejectedEvent,
    CollectorRejection,
    FileSourcePosition,
    JsonObject,
    JsonPrimitive,
    JsonValue,
    OcsfAuthenticationEvent,
    RejectedEventPayload,
    RejectedEventSource,
    RejectedPayloadContentType,
} from "./domain/collector-contract.types.js";

// -----------------------------------------------------------------------------
// Public verification contracts
// -----------------------------------------------------------------------------

export type {
    CollectorTrustFailureReason,
    CollectorTrustResolution,
    ICollectorMessageVerifier,
    ICollectorTrustStore,
    Sha256Digest,
    VerifiedCollectorMessage,
} from "./domain/collector-verification.contracts.js";

// -----------------------------------------------------------------------------
// Public verification errors
// -----------------------------------------------------------------------------

export {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
    isCollectorVerificationError,
} from "./domain/collector-verification.errors.js";

export type {
    CollectorVerificationErrorCode,
    CollectorVerificationErrorDetails,
    CollectorVerificationStage,
} from "./domain/collector-verification.errors.js";

// -----------------------------------------------------------------------------
// Verification composition
// -----------------------------------------------------------------------------

export { createCollectorMessageVerifier } from "./composition/ingestion-verification.dependencies.js";

export type { IngestionVerificationDependencies } from "./composition/ingestion-verification.dependencies.js";

// -----------------------------------------------------------------------------
// Runtime-configured composition
// -----------------------------------------------------------------------------

export { createConfiguredCollectorMessageVerifier } from "./composition/configured-ingestion-verification.dependencies.js";

export type { CollectorVerificationRuntimeConfiguration } from "./composition/configured-ingestion-verification.dependencies.js";

// -----------------------------------------------------------------------------
// Collector trust configuration
// -----------------------------------------------------------------------------

export {
    CollectorTrustConfigurationError,
    createConfiguredCollectorTrustStore,
} from "./infrastructure/collector-trust.configuration.js";

export type { CollectorTrustConfiguration } from "./infrastructure/collector-trust.configuration.js";

// -----------------------------------------------------------------------------
// Local-development and test trust store
// -----------------------------------------------------------------------------

export { InMemoryCollectorTrustStore } from "./infrastructure/collector-trust.store.js";

export type { CollectorTrustStoreEntry } from "./infrastructure/collector-trust.store.js";

// -----------------------------------------------------------------------------
// Safe Collector file intake (BE-ING-01B)
// -----------------------------------------------------------------------------

export { MAX_COLLECTOR_BATCH_BYTES } from "./domain/collector-file-intake.contracts.js";

export type {
    ClaimedCollectorBatchFile,
    CollectorBatchQuarantineReason,
    CompleteCollectorProcessingJobResult,
    CollectorFileIntakeConfiguration,
    CollectorFileIntakeReport,
    CollectorFileRecoveryReport,
    CollectorIntakeIgnoredFileReason,
    ICollectorFileIntake,
    ICollectorProcessingFileLifecycle,
    IgnoredCollectorFile,
    QuarantinedCollectorBatchFile,
} from "./domain/collector-file-intake.contracts.js";

export type {
    CollectorEventNormalizationStats,
    ICollectorEventNormalizer,
    NormalizedCollectorBatch,
} from "./domain/collector-event-normalization.contracts.js";

export {
    COLLECTOR_FILE_INTAKE_ERROR_CODES,
    CollectorFileIntakeError,
    isCollectorFileIntakeError,
} from "./domain/collector-file-intake.errors.js";

export type {
    CollectorFileIntakeErrorCode,
    CollectorFileIntakeErrorDetails,
    CollectorFileIntakeStage,
} from "./domain/collector-file-intake.errors.js";

export { CollectorFileIntakeService } from "./infrastructure/collector-file-intake.service.js";

export { OcsfCollectorEventNormalizer } from "./infrastructure/ocsf-collector-event.normalizer.js";

export { PersistNormalizedCollectorEventsService } from "./application/persist-normalized-collector-events.service.js";

export type {
    PersistNormalizedCollectorEventsDependencies,
    PersistNormalizedCollectorEventsResult,
} from "./application/persist-normalized-collector-events.service.js";

export type {
    CollectorProcessingJob,
    IProcessingQueue,
    ProcessingQueueEnqueueResult,
} from "./domain/processing-queue.contracts.js";

export { InMemoryProcessingQueue } from "./infrastructure/in-memory-processing.queue.js";

export { BullMqProcessingQueue } from "./infrastructure/bullmq-processing.queue.js";

export type { BullMqProcessingQueueConfiguration } from "./infrastructure/bullmq-processing.queue.js";

export { createConfiguredCollectorIntakeCycle } from "./composition/configured-collector-intake-cycle.dependencies.js";

export type {
    CollectorIntakeCycleRuntimeConfiguration,
    ConfiguredCollectorIntakeCycle,
} from "./composition/configured-collector-intake-cycle.dependencies.js";

export { BullMqCollectorProcessingWorker } from "./infrastructure/bullmq-collector-processing.worker.js";

export type {
    BullMqCollectorProcessingWorkerConfiguration,
    BullMqCollectorProcessingWorkerDependencies,
} from "./infrastructure/bullmq-collector-processing.worker.js";

export { createConfiguredCollectorProcessingWorker } from "./composition/configured-collector-processing-worker.dependencies.js";

export type {
    CollectorProcessingWorkerRuntimeConfiguration,
    ConfiguredCollectorProcessingWorker,
} from "./composition/configured-collector-processing-worker.dependencies.js";

// -----------------------------------------------------------------------------
// Signed heartbeat consumption and Collector monitoring (BE-ING-01F)
// -----------------------------------------------------------------------------

export { MAX_COLLECTOR_HEARTBEAT_BYTES } from "./domain/collector-heartbeat.contracts.js";

export type {
    CollectorHeartbeatSnapshot,
    ICollectorHeartbeatFileReader,
} from "./domain/collector-heartbeat.contracts.js";

export {
    COLLECTOR_HEARTBEAT_ERROR_CODES,
    CollectorHeartbeatError,
    isCollectorHeartbeatError,
} from "./domain/collector-heartbeat.errors.js";

export type {
    CollectorHeartbeatErrorCode,
} from "./domain/collector-heartbeat.errors.js";

export { CollectorHeartbeatFileReader } from "./infrastructure/collector-heartbeat-file.reader.js";

export type {
    CollectorHeartbeatFileReaderConfiguration,
} from "./infrastructure/collector-heartbeat-file.reader.js";

export { ConsumeCollectorHeartbeatService } from "./application/consume-collector-heartbeat.service.js";

export type {
    ConsumeCollectorHeartbeatDependencies,
    ConsumeCollectorHeartbeatResult,
} from "./application/consume-collector-heartbeat.service.js";

export { MarkStaleCollectorsOfflineService } from "./application/mark-stale-collectors-offline.service.js";

export type {
    MarkStaleCollectorsOfflineDependencies,
    MarkStaleCollectorsOfflineResult,
} from "./application/mark-stale-collectors-offline.service.js";

export { createConfiguredCollectorHeartbeatMonitor } from "./composition/configured-collector-heartbeat-monitor.dependencies.js";

export type {
    CollectorHeartbeatMonitorRuntimeConfiguration,
    ConfiguredCollectorHeartbeatMonitor,
} from "./composition/configured-collector-heartbeat-monitor.dependencies.js";

