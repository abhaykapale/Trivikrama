const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(?:password|passwordhash|secret|token|authorization|cookie|credential|privatekey|databaseurl|mongodburi|redisurl|hmac)/iu;

/**
 * Returns a redacted copy of structured metadata before it is logged or
 * included in an error response. Circular references are replaced safely.
 */
export function redactSensitiveData<T>(value: T): T {
  return sanitizeValue(value, new WeakSet<object>()) as T;
}

/** Redacts a Winston info record in place so format symbols are preserved. */
export function redactLogRecordInPlace(
  record: Record<string | symbol, unknown>,
): void {
  const seen = new WeakSet<object>();
  seen.add(record);

  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      continue;
    }

    if (SENSITIVE_KEY_PATTERN.test(normalizeKey(key))) {
      record[key] = REDACTED;
      continue;
    }

    record[key] = sanitizeValue(record[key], seen);
  }
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Error) {
    const copy = new Error(redactSensitiveText(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? redactSensitiveText(value.stack) : undefined;
    return copy;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const output: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(normalizeKey(key))
        ? REDACTED
        : sanitizeValue(entry, seen);
    }

    return output;
  }

  return value;
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "");
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
      REDACTED,
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^\s]+@/giu,
      `$1${REDACTED}@`,
    )
    .replace(
      /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/giu,
      `$1${REDACTED}`,
    )
    .replace(
      /((?:jwt[_-]?secret|collector[_-]?hmac[_-]?secret|password|token)\s*[:=]\s*)[^\s,;]+/giu,
      `$1${REDACTED}`,
    );
}
