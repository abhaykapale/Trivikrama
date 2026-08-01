/**
 * Shared utility functions for the auth application layer.
 *
 * Centralised here to avoid duplication across use-cases and services.
 */

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    isRecord(error) &&
    typeof error.code === "string" &&
    error.code === code
  );
}

export function assertPositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}
