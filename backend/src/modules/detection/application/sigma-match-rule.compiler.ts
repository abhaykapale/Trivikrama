import { createHash } from "node:crypto";

import {
  evaluateConditionExpression,
  parseConditionExpression,
} from "./condition-expression.js";
import type {
  CompiledSigmaMatchRule,
  DetectionEvent,
  RuleSeverity,
} from "../domain/rule-engine.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";
import {
  compileEventFieldPath,
  resolveOwnEventField,
} from "./event-field-accessor.js";

type EventPredicate = (event: DetectionEvent) => boolean;
type FieldOperator =
  | "exact"
  | "contains"
  | "startswith"
  | "endswith"
  | "re"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not"
  | "exists";

const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/u;
const SELECTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
const SEVERITIES = new Set<RuleSeverity>([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
]);
const OPERATORS = new Set<FieldOperator>([
  "contains",
  "startswith",
  "endswith",
  "re",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not",
  "exists",
]);
const MAX_SELECTIONS = 64;
const MAX_FIELDS_PER_SELECTION = 64;
const MAX_REGEX_LENGTH = 128;
const TIME_WINDOW_PATTERN = /^(\d+)([smh])$/u;
const MAX_COOLDOWN_SECONDS = 86_400;

export function compileSigmaMatchRule(
  document: unknown,
  sourceForHash: string,
): CompiledSigmaMatchRule {
  const root = requireObject(document, "$", "must be a YAML mapping");
  const title = requireString(root.title, "title", 1, 256);
  const id = requireString(root.id, "id", 3, 128);

  if (!RULE_ID_PATTERN.test(id)) {
    fail("id", "must be a lowercase UUID or slug containing only letters, digits, '.', '_' or '-'");
  }

  if (root.status !== "active") {
    fail("status", "BE-DET-01A compiles only active match rules");
  }

  const severity = requireSeverity(root.level);
  const weight = requireFiniteNumber(root.weight, "weight", 0, 1);
  const priority =
    root.priority === undefined
      ? 500
      : requireInteger(root.priority, "priority", 1, 1_000);
  const description =
    root.description === undefined
      ? ""
      : requireString(root.description, "description", 0, 65_535);
  const tags = readStringArray(root.tags, "tags", 128);
  const logsource = requireObject(root.logsource, "logsource", "must be a mapping");
  const classUid = requireInteger(logsource.class_uid, "logsource.class_uid", 0);
  const categoryUid =
    logsource.category_uid === undefined
      ? undefined
      : requireInteger(logsource.category_uid, "logsource.category_uid", 0);
  const detection = requireObject(root.detection, "detection", "must be a mapping");
  const cooldownSeconds = compileCooldown(root.alert);

  if (detection.count !== undefined || detection.sequence !== undefined) {
    fail("detection", "BE-DET-01A supports stateless match rules only");
  }

  const condition = requireString(detection.condition, "detection.condition", 1, 1_024);
  const selectionEntries = Object.entries(detection).filter(
    ([name]) => name !== "condition",
  );

  if (selectionEntries.length === 0 || selectionEntries.length > MAX_SELECTIONS) {
    fail("detection", `must contain 1-${MAX_SELECTIONS} selections`);
  }

  const selectionPredicates = new Map<string, EventPredicate>();

  for (const [name, selection] of selectionEntries) {
    if (!SELECTION_NAME_PATTERN.test(name) || isReservedWord(name)) {
      fail(`detection.${name}`, "has an invalid or reserved selection name");
    }

    selectionPredicates.set(
      name,
      compileSelection(selection, `detection.${name}`),
    );
  }

  const expression = parseConditionExpression(
    condition,
    new Set(selectionPredicates.keys()),
  );

  return Object.freeze({
    type: "match",
    id,
    sigmaId: id,
    title,
    description,
    severity,
    weight,
    priority,
    logsource: Object.freeze({
      classUid,
      ...(categoryUid === undefined ? {} : { categoryUid }),
    }),
    tags: Object.freeze(tags),
    condition,
    cooldownSeconds,
    compiledHash: createHash("sha256").update(sourceForHash, "utf8").digest("hex"),
    matches: (event: DetectionEvent): boolean => {
      if (
        event.class_uid !== classUid ||
        (categoryUid !== undefined && event.category_uid !== categoryUid)
      ) {
        return false;
      }

      const results = new Map<string, boolean>();

      for (const [name, predicate] of selectionPredicates) {
        results.set(name, predicate(event));
      }

      return evaluateConditionExpression(expression, results);
    },
  });
}

function compileCooldown(value: unknown): number {
  if (value === undefined) return 0;

  const alert = requireObject(value, "alert", "must be a mapping");
  const unknownKeys = Object.keys(alert).filter((key) => key !== "cooldown");
  if (unknownKeys.length > 0) {
    fail(`alert.${unknownKeys[0]}`, "is not supported");
  }
  if (alert.cooldown === undefined) return 0;

  const cooldown = requireString(
    alert.cooldown,
    "alert.cooldown",
    2,
    16,
  );
  const match = TIME_WINDOW_PATTERN.exec(cooldown);
  if (match === null) {
    fail("alert.cooldown", "must use the format <positive integer><s|m|h>");
  }

  const amount = Number(match[1]);
  const multiplier = match[2] === "s" ? 1 : match[2] === "m" ? 60 : 3_600;
  const seconds = amount * multiplier;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > MAX_COOLDOWN_SECONDS
  ) {
    fail(
      "alert.cooldown",
      `must resolve to 1-${MAX_COOLDOWN_SECONDS} seconds`,
    );
  }

  return seconds;
}

function compileSelection(value: unknown, path: string): EventPredicate {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > MAX_FIELDS_PER_SELECTION) {
      fail(path, `must contain 1-${MAX_FIELDS_PER_SELECTION} alternatives`);
    }

    const alternatives = value.map((entry, index) =>
      compileSelectionMap(entry, `${path}[${index}]`),
    );
    return (event) => alternatives.some((predicate) => predicate(event));
  }

  return compileSelectionMap(value, path);
}

function compileSelectionMap(value: unknown, path: string): EventPredicate {
  const selection = requireObject(value, path, "must be a mapping or list of mappings");
  const entries = Object.entries(selection);

  if (entries.length === 0 || entries.length > MAX_FIELDS_PER_SELECTION) {
    fail(path, `must contain 1-${MAX_FIELDS_PER_SELECTION} field conditions`);
  }

  const predicates = entries.map(([fieldExpression, target]) =>
    compileFieldCondition(fieldExpression, target, `${path}.${fieldExpression}`),
  );

  return (event) => predicates.every((predicate) => predicate(event));
}

function compileFieldCondition(
  fieldExpression: string,
  target: unknown,
  path: string,
): EventPredicate {
  const parts = fieldExpression.split("|");

  if (parts.length > 2) {
    fail(path, "uses unsupported chained modifiers");
  }

  const fieldPath = parts[0];
  const operator = (parts[1] ?? "exact") as FieldOperator;
  const fieldSegments = compileEventFieldPath(fieldPath, path);

  if (operator !== "exact" && !OPERATORS.has(operator)) {
    fail(path, `uses unsupported operator '${operator}'`);
  }

  const compare = compileComparison(operator, target, path);
  return (event) => compare(resolveOwnEventField(event, fieldSegments));
}

function compileComparison(
  operator: FieldOperator,
  target: unknown,
  path: string,
): (value: unknown) => boolean {
  if (operator === "exists") {
    if (typeof target !== "boolean") {
      fail(path, "requires a boolean target");
    }

    return target
      ? (value) => value !== undefined && value !== null
      : (value) => value === undefined || value === null;
  }

  if (operator === "in") {
    const targets = requireScalarArray(target, path);
    return (value) => targets.some((candidate) => Object.is(value, candidate));
  }

  if (operator === "not") {
    const targets = Array.isArray(target)
      ? requireScalarArray(target, path)
      : [requireScalar(target, path)];
    return (value) => targets.every((candidate) => !Object.is(value, candidate));
  }

  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    if (typeof target !== "number" || !Number.isFinite(target)) {
      fail(path, "requires a finite numeric target");
    }

    return (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return false;
      }

      switch (operator) {
        case "gt": return value > target;
        case "gte": return value >= target;
        case "lt": return value < target;
        case "lte": return value <= target;
      }
    };
  }

  if (operator === "re") {
    if (typeof target !== "string") {
      fail(path, "requires a string regex pattern");
    }

    const regex = compileGuardedRegex(target, path);
    return (value) => typeof value === "string" && regex.test(value);
  }

  if (operator === "contains" || operator === "startswith" || operator === "endswith") {
    const targets = Array.isArray(target)
      ? requireMatchStringArray(target, path, 128)
      : [requireMatchString(target, path)];

    return (value) => {
      if (typeof value !== "string") {
        return false;
      }

      return targets.some((candidate) => {
        switch (operator) {
          case "contains": return value.includes(candidate);
          case "startswith": return value.startsWith(candidate);
          case "endswith": return value.endsWith(candidate);
        }
      });
    };
  }

  const targets = Array.isArray(target)
    ? requireScalarArray(target, path)
    : [requireScalar(target, path)];
  return (value) => targets.some((candidate) => Object.is(value, candidate));
}

function compileGuardedRegex(pattern: string, path: string): RegExp {
  if (pattern.length === 0 || pattern.length > MAX_REGEX_LENGTH) {
    fail(path, `regex must contain 1-${MAX_REGEX_LENGTH} characters`);
  }

  if (/[(){}]/u.test(pattern) || /\\[1-9]/u.test(pattern)) {
    fail(path, "regex groups, counted repetitions and backreferences are not allowed");
  }

  const quantifiers = pattern.match(/(?<!\\)[*+?]/gu)?.length ?? 0;

  if (quantifiers > 1) {
    fail(path, "regex may contain at most one unescaped quantifier");
  }

  try {
    return new RegExp(pattern, "u");
  } catch {
    fail(path, "contains invalid regex syntax");
  }
}

function requireObject(
  value: unknown,
  path: string,
  message: string,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) {
    fail(path, message);
  }

  return value;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string" || value.trim().length < minimum || value.length > maximum) {
    fail(path, `must be a string containing ${minimum}-${maximum} characters`);
  }

  return value.trim();
}

function requireSeverity(value: unknown): RuleSeverity {
  if (typeof value !== "string" || !SEVERITIES.has(value as RuleSeverity)) {
    fail("level", "must be critical, high, medium, low or informational");
  }

  return value as RuleSeverity;
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`);
  }

  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(path, `must be an integer between ${minimum} and ${maximum}`);
  }

  return value as number;
}

function readStringArray(value: unknown, path: string, maximum: number): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return requireStringArray(value, path, maximum);
}

function requireStringArray(value: unknown, path: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(path, `must be an array containing at most ${maximum} strings`);
  }

  return value.map((entry, index) => requireString(entry, `${path}[${index}]`, 1, 1_024));
}

function requireMatchStringArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    fail(path, `must be a non-empty array containing at most ${maximum} strings`);
  }

  return value.map((entry, index) =>
    requireMatchString(entry, `${path}[${index}]`),
  );
}

function requireMatchString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 4_096) {
    fail(path, "must be a string containing at most 4096 characters");
  }

  return value;
}

function requireScalarArray(value: unknown, path: string): readonly (string | number | boolean | null)[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    fail(path, "must be a non-empty scalar array with at most 128 entries");
  }

  return value.map((entry, index) => requireScalar(entry, `${path}[${index}]`));
}

function requireScalar(value: unknown, path: string): string | number | boolean | null {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    fail(path, "must be a string, number, boolean or null");
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    fail(path, "must be finite");
  }

  return value as string | number | boolean | null;
}

function isReservedWord(value: string): boolean {
  return value.toLowerCase() === "and" || value.toLowerCase() === "or" || value.toLowerCase() === "not";
}

function fail(path: string, message: string): never {
  throw new RuleValidationError([{ path, message }]);
}
