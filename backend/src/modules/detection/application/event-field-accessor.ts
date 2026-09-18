import { RuleValidationError } from "../domain/rule-validation.error.js";

const FIELD_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const BLOCKED_FIELD_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function compileEventFieldPath(
  fieldPath: string,
  errorPath: string,
): readonly string[] {
  const segments = fieldPath.split(".");

  if (
    fieldPath.length === 0 ||
    fieldPath.length > 256 ||
    segments.length > 16 ||
    segments.some(
      (segment) =>
        !FIELD_SEGMENT_PATTERN.test(segment) ||
        BLOCKED_FIELD_SEGMENTS.has(segment),
    )
  ) {
    throw new RuleValidationError([
      {
        path: errorPath,
        message: "contains an invalid or unsafe dot-notation field path",
      },
    ]);
  }

  return Object.freeze(segments);
}

export function resolveOwnEventField(
  value: unknown,
  segments: readonly string[],
): unknown {
  let current: unknown = value;

  for (const segment of segments) {
    if (
      !isPlainObject(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
