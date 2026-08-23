const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|token|authorization|cookie|set-cookie|secret|jwt|session/i;

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function redactAuthSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactTokenString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "<redacted>"
        : redactValue(nestedValue);
    }

    return output;
  }

  return value;
}

function redactTokenString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer <redacted>")
    .replace(JWT_PATTERN, "<redacted-jwt>");
}
