import type { CompiledSigmaCountRule } from "../domain/rule-engine.contracts.js";
import { parseYamlRuleDocument } from "../infrastructure/yaml-rule-document.parser.js";
import { compileSigmaCountRule } from "./sigma-count-rule.compiler.js";

export function compileSigmaCountRuleYaml(source: string): CompiledSigmaCountRule {
  return compileSigmaCountRule(parseYamlRuleDocument(source), source);
}
