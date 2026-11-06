import type { RuleSeverity, RuleStatus, RuleType } from "../../../database/repositories/rules/rule.repository.js";

export type RuleQuerySortField = "name" | "severity" | "status" | "createdAt" | "updatedAt";
export type RuleQuerySortOrder = "asc" | "desc";

export interface ListRulesQuery {
  readonly orgId: string;
  readonly status?: RuleStatus;
  readonly type?: RuleType;
  readonly severity?: RuleSeverity;
  readonly search?: string;
  readonly tag?: string;
  readonly isBuiltin?: boolean;
  readonly page: number;
  readonly limit: number;
  readonly sort: RuleQuerySortField;
  readonly order: RuleQuerySortOrder;
}

export interface GetRuleDetailQuery {
  readonly orgId: string;
  readonly ruleId: string;
}

export interface RuleQueryRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: RuleStatus;
  readonly type: RuleType;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly priority: number;
  readonly classUid: number | null;
  readonly categoryUid: number | null;
  readonly tags: readonly string[];
  readonly falsePositives: readonly string[];
  readonly references: readonly string[];
  readonly yamlContent: string;
  readonly compiledHash: string | null;
  readonly isBuiltin: boolean;
  readonly version: number;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly alertsGenerated: number;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type RuleListItemView = Omit<
  RuleQueryRecord,
  "yamlContent" | "compiledHash" | "falsePositives" | "references" | "createdBy" | "updatedBy"
>;

export type RuleDetailView = Omit<RuleQueryRecord, "alertsGenerated" | "lastTriggeredAt">;

export interface RuleQueryPage {
  readonly items: readonly RuleQueryRecord[];
  readonly total: number;
}

export interface RulePaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface ListRulesResult {
  readonly data: readonly RuleListItemView[];
  readonly pagination: RulePaginationView;
}

export interface IRuleQueryRepository {
  list(input: ListRulesQuery): Promise<RuleQueryPage>;
  findById(input: GetRuleDetailQuery): Promise<RuleQueryRecord | null>;
}
