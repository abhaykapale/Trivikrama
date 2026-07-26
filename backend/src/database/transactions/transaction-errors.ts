const RETRYABLE_POSTGRES_ERROR_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
]);

export interface ClassifiedTransactionError {
  readonly code?: string;
  readonly retryable: boolean;
  readonly message: string;
}

export function classifyTransactionError(error: unknown): ClassifiedTransactionError {
  const code = readPostgresErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);

  return {
    code,
    retryable: code !== undefined && RETRYABLE_POSTGRES_ERROR_CODES.has(code),
    message,
  };
}

function readPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
