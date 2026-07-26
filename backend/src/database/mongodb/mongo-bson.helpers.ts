import { Double, Int32 } from "mongodb";

export function mongoInt(value: number, fieldName: string): Int32 {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return new Int32(value);
}

export function mongoDouble(value: number, fieldName: string): Double {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite`);
  }

  return new Double(value);
}

export function mongoOptionalInt(
  value: number | undefined,
  fieldName: string,
): Int32 | undefined {
  return value === undefined ? undefined : mongoInt(value, fieldName);
}

export function mongoOptionalDouble(
  value: number | undefined,
  fieldName: string,
): Double | undefined {
  return value === undefined ? undefined : mongoDouble(value, fieldName);
}

export function omitUndefined<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
