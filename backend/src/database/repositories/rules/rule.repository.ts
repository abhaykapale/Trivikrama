import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export type RuleStatus = "active" | "disabled" | "archived";
export type RuleType = "match" | "count" | "sequence";
export type RuleSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface RuleRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: RuleStatus;
  readonly type: RuleType;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly yamlContent: string;
  readonly compiledHash: string | null;
  readonly classUid: number | null;
  readonly categoryUid: number | null;
  readonly tags: readonly unknown[];
  readonly falsePositives: readonly unknown[];
  readonly ruleReferences: readonly unknown[];
  readonly version: number;
  readonly isBuiltin: boolean;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

export interface RuleListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly status?: RuleStatus;
  readonly type?: RuleType;
  readonly severity?: RuleSeverity;
  readonly isBuiltin?: boolean;
  readonly classUid?: number;
  readonly tag?: string;
  readonly search?: string;
}

export interface CreateRuleInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: RuleStatus;
  readonly type: RuleType;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly yamlContent: string;
  readonly compiledHash?: string | null;
  readonly classUid?: number | null;
  readonly categoryUid?: number | null;
  readonly tags?: readonly unknown[];
  readonly falsePositives?: readonly unknown[];
  readonly ruleReferences?: readonly unknown[];
  readonly version?: number;
  readonly isBuiltin?: boolean;
  readonly createdBy?: string | null;
  readonly updatedBy?: string | null;
  readonly orgId?: string;
}

export interface UpdateRuleInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: RuleStatus;
  readonly type?: RuleType;
  readonly severity?: RuleSeverity;
  readonly weight?: number;
  readonly yamlContent?: string;
  readonly compiledHash?: string | null;
  readonly classUid?: number | null;
  readonly categoryUid?: number | null;
  readonly tags?: readonly unknown[];
  readonly falsePositives?: readonly unknown[];
  readonly ruleReferences?: readonly unknown[];
  readonly version?: number;
  readonly updatedBy?: string | null;
}

export interface IRuleRepository {
  withTransaction(transaction: TransactionClient): IRuleRepository;
  findById(id: string): Promise<RuleRecord | null>;
  findByName(name: string, orgId?: string): Promise<RuleRecord | null>;
  findActive(orgId?: string): Promise<readonly RuleRecord[]>;
  list(filters?: RuleListFilters): Promise<PageResult<RuleRecord>>;
  create(input: CreateRuleInput): Promise<RuleRecord>;
  update(id: string, input: UpdateRuleInput): Promise<RuleRecord | null>;
  enable(id: string, updatedBy?: string | null): Promise<RuleRecord | null>;
  disable(id: string, updatedBy?: string | null): Promise<RuleRecord | null>;
  archive(id: string, updatedBy?: string | null): Promise<RuleRecord | null>;
}
