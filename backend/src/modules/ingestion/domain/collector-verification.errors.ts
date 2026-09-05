// -----------------------------------------------------------------------------
// Verification stages
// -----------------------------------------------------------------------------

export type CollectorVerificationStage =
    | "precheck"
    | "parsing"
    | "identity"
    | "integrity"
    | "schema"
    | "semantics";

// -----------------------------------------------------------------------------
// Verification error codes
// -----------------------------------------------------------------------------

export const COLLECTOR_VERIFICATION_ERROR_CODES = {
    FILE_TOO_LARGE: "FILE_TOO_LARGE",

    INVALID_UTF8: "INVALID_UTF8",
    JSON_BOM_NOT_ALLOWED: "JSON_BOM_NOT_ALLOWED",
    INVALID_JSON: "INVALID_JSON",
    DUPLICATE_JSON_KEY: "DUPLICATE_JSON_KEY",
    INVALID_UNICODE: "INVALID_UNICODE",
    INVALID_NUMBER: "INVALID_NUMBER",
    UNSAFE_INTEGER: "UNSAFE_INTEGER",

    UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
    UNSUPPORTED_MESSAGE_TYPE: "UNSUPPORTED_MESSAGE_TYPE",

    UNKNOWN_COLLECTOR: "UNKNOWN_COLLECTOR",
    UNKNOWN_KEY_ID: "UNKNOWN_KEY_ID",

    UNSUPPORTED_INTEGRITY_ALGORITHM: "UNSUPPORTED_INTEGRITY_ALGORITHM",
    MALFORMED_HMAC: "MALFORMED_HMAC",
    INVALID_HMAC: "INVALID_HMAC",

    SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",

    EVENT_COUNT_MISMATCH: "EVENT_COUNT_MISMATCH",
    BATCH_ID_MISMATCH: "BATCH_ID_MISMATCH",
    DUPLICATE_EVENT_ID: "DUPLICATE_EVENT_ID",
    INVALID_SOURCE_POSITION: "INVALID_SOURCE_POSITION",
    RECORD_TOO_LARGE: "RECORD_TOO_LARGE",
    EVENT_IDENTITY_MISMATCH: "EVENT_IDENTITY_MISMATCH",

    INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
    INVALID_IP_ADDRESS: "INVALID_IP_ADDRESS",

    SOURCE_IDENTITY_MISMATCH: "SOURCE_IDENTITY_MISMATCH",
    MAPPING_VERSION_MISMATCH: "MAPPING_VERSION_MISMATCH",
    OCSF_VERSION_MISMATCH: "OCSF_VERSION_MISMATCH",
    OCSF_MAPPING_MISMATCH: "OCSF_MAPPING_MISMATCH",

    INVALID_HEARTBEAT: "INVALID_HEARTBEAT",
    INVALID_REJECTED_EVENT: "INVALID_REJECTED_EVENT",
    REJECTION_PAYLOAD_MISMATCH: "REJECTION_PAYLOAD_MISMATCH",
} as const;

export type CollectorVerificationErrorCode =
    (typeof COLLECTOR_VERIFICATION_ERROR_CODES)[keyof typeof COLLECTOR_VERIFICATION_ERROR_CODES];

// -----------------------------------------------------------------------------
// Safe diagnostic details
// -----------------------------------------------------------------------------

export interface CollectorVerificationErrorDetails {
    readonly [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Verification error
// -----------------------------------------------------------------------------

export class CollectorVerificationError extends Error {
    public readonly disposition = "quarantine" as const;

    public constructor(
        public readonly code: CollectorVerificationErrorCode,
        public readonly stage: CollectorVerificationStage,
        message: string,
        public readonly details?: CollectorVerificationErrorDetails,
    ) {
        super(message);

        this.name = "CollectorVerificationError";

        Object.setPrototypeOf(this, CollectorVerificationError.prototype);
    }
}

// -----------------------------------------------------------------------------
// Error type guard
// -----------------------------------------------------------------------------

export function isCollectorVerificationError(error: unknown): error is CollectorVerificationError {
    return error instanceof CollectorVerificationError;
}
