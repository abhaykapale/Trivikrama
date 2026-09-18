import type {
  CompiledSigmaCountRule,
  CountRuleConfiguration,
} from "../domain/rule-engine.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";
import { compileEventFieldPath } from "./event-field-accessor.js";
import { compileSigmaMatchRule } from "./sigma-match-rule.compiler.js";

const TIME_WINDOW_PATTERN = /^(\d+)([smh])$/u;
const MAX_THRESHOLD = 1_000_000;
const MAX_TIME_WINDOW_SECONDS = 86_400;

export function compileSigmaCountRule(
  document: unknown,
  sourceForHash: string,
): CompiledSigmaCountRule {
  const root = requirePlainObject(document, "$", "must be a YAML mapping");
  const detection = requirePlainObject(
    root.detection,
    "detection",
    "must be a mapping",
  );
  const count = requirePlainObject(
    detection.count,
    "detection.count",
    "must be a mapping",
  );
  const field = requireTrimmedString(count.field, "detection.count.field");
  const threshold = requirePositiveInteger(
    count.threshold,
    "detection.count.threshold",
    MAX_THRESHOLD,
  );
  const timeWindowSeconds = parseTimeWindow(count.timewindow);
  const fieldSegments = compileEventFieldPath(field, "detection.count.field");
  const { count: _count, ...statelessDetection } = detection;
  const selectionRule = compileSigmaMatchRule(
    { ...root, detection: statelessDetection },
    sourceForHash,
  );

  const countConfiguration: CountRuleConfiguration = Object.freeze({
    field,
    fieldSegments,
    threshold,
    timeWindowSeconds,
  });

  return Object.freeze({
    ...selectionRule,
    type: "count",
    count: countConfiguration,
  });
}

function parseTimeWindow(value: unknown): number {
  const timeWindow = requireTrimmedString(
    value,
    "detection.count.timewindow",
  );
  const match = TIME_WINDOW_PATTERN.exec(timeWindow);

  if (match === null) {
    fail(
      "detection.count.timewindow",
      "must use the format <positive integer><s|m|h>",
    );
  }

  const amount = Number(match[1]);
  const multiplier = match[2] === "s" ? 1 : match[2] === "m" ? 60 : 3_600;
  const seconds = amount * multiplier;

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > MAX_TIME_WINDOW_SECONDS
  ) {
    fail(
      "detection.count.timewindow",
      `must resolve to 1-${MAX_TIME_WINDOW_SECONDS} seconds`,
    );
  }

  return seconds;
}

function requirePlainObject(
  value: unknown,
  path: string,
  message: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, message);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, message);
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireTrimmedString(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 256
  ) {
    fail(path, "must be a non-blank string of at most 256 characters");
  }

  return value.trim();
}

function requirePositiveInteger(
  value: unknown,
  path: string,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail(path, `must be an integer between 1 and ${maximum}`);
  }

  return value;
}

function fail(path: string, message: string): never {
  throw new RuleValidationError([{ path, message }]);
}
