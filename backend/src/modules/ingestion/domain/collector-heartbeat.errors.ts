export const COLLECTOR_HEARTBEAT_ERROR_CODES = {
    INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
    HEARTBEAT_NOT_REGULAR: "HEARTBEAT_NOT_REGULAR",
    HEARTBEAT_EMPTY: "HEARTBEAT_EMPTY",
    HEARTBEAT_TOO_LARGE: "HEARTBEAT_TOO_LARGE",
    HEARTBEAT_CHANGED: "HEARTBEAT_CHANGED",
    FILESYSTEM_OPERATION_FAILED: "FILESYSTEM_OPERATION_FAILED",
    UNEXPECTED_MESSAGE_TYPE: "UNEXPECTED_MESSAGE_TYPE",
    HEARTBEAT_FROM_FUTURE: "HEARTBEAT_FROM_FUTURE",
    HEARTBEAT_SEQUENCE_COLLISION: "HEARTBEAT_SEQUENCE_COLLISION",
} as const;

export type CollectorHeartbeatErrorCode =
    (typeof COLLECTOR_HEARTBEAT_ERROR_CODES)[keyof typeof COLLECTOR_HEARTBEAT_ERROR_CODES];

export class CollectorHeartbeatError extends Error {
    public constructor(
        public readonly code: CollectorHeartbeatErrorCode,
        message: string,
        public readonly details?: Readonly<Record<string, unknown>>,
    ) {
        super(message);
        this.name = "CollectorHeartbeatError";
        Object.setPrototypeOf(this, CollectorHeartbeatError.prototype);
    }
}

export function isCollectorHeartbeatError(error: unknown): error is CollectorHeartbeatError {
    return error instanceof CollectorHeartbeatError;
}

