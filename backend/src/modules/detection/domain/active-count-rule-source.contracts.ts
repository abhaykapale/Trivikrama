import type {
  CompiledSigmaCountRule,
  RuleSeverity,
} from "./rule-engine.contracts.js";

export interface ActiveCountRuleSourceRecord {
  readonly databaseId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly classUid: number | null;
  readonly categoryUid: number | null;
  readonly yamlContent: string;
}

export interface IActiveCountRuleSource {
  listActiveCountRules(
    organizationId: string,
  ): Promise<readonly ActiveCountRuleSourceRecord[]>;
}

export interface OrganizationCompiledCountRule
  extends CompiledSigmaCountRule {
  readonly organizationId: string;
}
