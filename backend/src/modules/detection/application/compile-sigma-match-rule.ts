import { compileSigmaMatchRule } from "./sigma-match-rule.compiler.js";
import type { CompiledSigmaMatchRule } from "../domain/rule-engine.contracts.js";
import { parseYamlRuleDocument } from "../infrastructure/yaml-rule-document.parser.js";

export function compileSigmaMatchRuleYaml(source: string): CompiledSigmaMatchRule {
  return compileSigmaMatchRule(parseYamlRuleDocument(source), source);
}
