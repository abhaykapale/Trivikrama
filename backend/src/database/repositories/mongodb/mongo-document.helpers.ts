import { Double, Int32 } from "mongodb";

export type MongoInsertDocument = Record<string, unknown>;

export function toMongoInt(value: number, fieldName: string): Int32 {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`);
  }

  return new Int32(value);
}

export function toMongoDouble(value: number, fieldName: string): Double {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite`);
  }

  return new Double(value);
}

export function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefined(item)) as T;
  }

  if (
    value instanceof Date ||
    value instanceof Int32 ||
    value instanceof Double
  ) {
    return value;
  }

  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        cleaned[key] = removeUndefined(entry);
      }
    }

    return cleaned as T;
  }

  return value;
}
