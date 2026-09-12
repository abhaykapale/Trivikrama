export type QuarantineRetryErrorCode =
  | "INVALID_FILENAME"
  | "QUARANTINE_FILE_NOT_FOUND"
  | "REQUEUE_DESTINATION_EXISTS"
  | "UNSAFE_HANDOFF_PATH"
  | "REQUEUE_FAILED";

export class QuarantineRetryError extends Error {
  public constructor(
    public readonly code: QuarantineRetryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QuarantineRetryError";
    Object.setPrototypeOf(this, QuarantineRetryError.prototype);
  }
}

export function isQuarantineRetryError(
  error: unknown,
): error is QuarantineRetryError {
  return error instanceof QuarantineRetryError;
}
