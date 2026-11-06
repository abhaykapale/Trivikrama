import { compileSigmaCountRule } from "./sigma-count-rule.compiler.js";
import { compileSigmaMatchRule } from "./sigma-match-rule.compiler.js";
import type {
  CompiledSigmaCountRule,
  CompiledSigmaMatchRule,
} from "../domain/rule-engine.contracts.js";
import {
  MAX_SIGMA_RULE_SOURCE_BYTES,
  type ValidatedSigmaRule,
} from "../domain/rule-command.contracts.js";
import { RuleValidationError } from "../domain/rule-validation.error.js";
import { parseYamlRuleDocument } from "../infrastructure/yaml-rule-document.parser.js";

export function validateSigmaRuleYaml(source: string): ValidatedSigmaRule {
  const { root, compiled } = parseAndCompileSupportedSigmaRule(source);

  return Object.freeze({
    sigmaId: compiled.sigmaId,
    name: compiled.title,
    description: compiled.description,
    status: "active",
    type: compiled.type,
    severity: compiled.severity,
    weight: compiled.weight,
    priority: compiled.priority,
    classUid: compiled.logsource.classUid,
    categoryUid: compiled.logsource.categoryUid ?? null,
    tags: Object.freeze([...compiled.tags]),
    falsePositives: Object.freeze(readStringArray(root.falsepositives, "falsepositives")),
    references: Object.freeze(readStringArray(root.references, "references", 2_048)),
    compiledHash: compiled.compiledHash,
    yamlContent: source,
  });
}

export type SupportedCompiledSigmaRule =
  | CompiledSigmaMatchRule
  | CompiledSigmaCountRule;

export function compileSupportedSigmaRuleYaml(source: string): SupportedCompiledSigmaRule {
  return parseAndCompileSupportedSigmaRule(source).compiled;
}

function parseAndCompileSupportedSigmaRule(source: string): {
  readonly root: Readonly<Record<string, unknown>>;
  readonly compiled: SupportedCompiledSigmaRule;
} {
  if (Buffer.byteLength(source, "utf8") > MAX_SIGMA_RULE_SOURCE_BYTES) {
    throw new RuleValidationError([
      {
        path: "$",
        message: `YAML source must not exceed ${MAX_SIGMA_RULE_SOURCE_BYTES} UTF-8 bytes`,
      },
    ]);
  }

  const document = parseYamlRuleDocument(source);
  const root = requireRecord(document, "$", "must be a YAML mapping");
  const detection = requireRecord(root.detection, "detection", "must be a mapping");

  if (detection.sequence !== undefined) {
    fail("detection.sequence", "sequence rules are not supported by the current Rule Engine");
  }

  const compiled = detection.count === undefined
    ? compileSigmaMatchRule(document, source)
    : compileSigmaCountRule(document, source);

  return { root, compiled };
}

function readStringArray(
  value: unknown,
  path: string,
  maxStringLength = 1_024,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    fail(path, "must be an array containing at most 128 strings");
  }

  return value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      entry.trim().length === 0 ||
      entry.length > maxStringLength
    ) {
      fail(
        `${path}[${index}]`,
        `must be a non-blank string of at most ${maxStringLength} characters`,
      );
    }
    return entry.trim();
  });
}

function requireRecord(
  value: unknown,
  path: string,
  message: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function fail(path: string, message: string): never {
  throw new RuleValidationError([{ path, message }]);
}
