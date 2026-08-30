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
