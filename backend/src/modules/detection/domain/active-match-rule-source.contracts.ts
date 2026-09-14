import type {
  CompiledSigmaMatchRule,
  RuleSeverity,
} from "./rule-engine.contracts.js";

export interface ActiveMatchRuleSourceRecord {
  readonly databaseId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly classUid: number | null;
  readonly categoryUid: number | null;
  readonly yamlContent: string;
}

export interface IActiveMatchRuleSource {
  listActiveMatchRules(
    organizationId: string,
  ): Promise<readonly ActiveMatchRuleSourceRecord[]>;
}

export interface OrganizationCompiledMatchRule
  extends CompiledSigmaMatchRule {
  readonly organizationId: string;
}

export interface RuleReloadReport {
  readonly organizationId: string;
  readonly sourceRules: number;
  readonly compiledRules: number;
  readonly reusedLastKnownGoodRules: number;
  readonly rejectedRules: number;
  readonly removedRules: number;
  readonly reloadedAt: Date;
}
