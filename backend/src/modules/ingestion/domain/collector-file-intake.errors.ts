export type CollectorFileIntakeStage =
    | "layout"
    | "discovery"
    | "claim"
    | "recovery"
    | "quarantine"
    | "read";

export const COLLECTOR_FILE_INTAKE_ERROR_CODES = {
    UNSAFE_HANDOFF_DIRECTORY: "UNSAFE_HANDOFF_DIRECTORY",
    INVALID_INTAKE_CONFIGURATION: "INVALID_INTAKE_CONFIGURATION",
    FILESYSTEM_OPERATION_FAILED: "FILESYSTEM_OPERATION_FAILED",
    CLAIMED_FILE_MISSING: "CLAIMED_FILE_MISSING",
    CLAIMED_FILE_UNSAFE_PATH: "CLAIMED_FILE_UNSAFE_PATH",
    CLAIMED_FILE_NOT_REGULAR: "CLAIMED_FILE_NOT_REGULAR",
    CLAIMED_FILE_CHANGED: "CLAIMED_FILE_CHANGED",
} as const;

export type CollectorFileIntakeErrorCode =
    (typeof COLLECTOR_FILE_INTAKE_ERROR_CODES)[keyof typeof COLLECTOR_FILE_INTAKE_ERROR_CODES];

export interface CollectorFileIntakeErrorDetails {
    readonly [key: string]: string | number | boolean | undefined;
}

/**
 * A filesystem/layout failure is retryable by the future watcher. It is not a
 * Collector-message verification error and must never be treated as a valid
 * reason to delete or quarantine an arbitrary path.
 */
export class CollectorFileIntakeError extends Error {
    public constructor(
        public readonly code: CollectorFileIntakeErrorCode,
        public readonly stage: CollectorFileIntakeStage,
        message: string,
        public readonly details?: CollectorFileIntakeErrorDetails,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "CollectorFileIntakeError";
        Object.setPrototypeOf(this, CollectorFileIntakeError.prototype);
    }
}

export function isCollectorFileIntakeError(
    error: unknown,
): error is CollectorFileIntakeError {
    return error instanceof CollectorFileIntakeError;
}
