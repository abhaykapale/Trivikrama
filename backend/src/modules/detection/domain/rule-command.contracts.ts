import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { IRuleRepository, RuleRecord, RuleSeverity, RuleType } from "../../../database/repositories/rules/rule.repository.js";
import type { AuthRole } from "../../auth/domain/index.js";

export const MAX_SIGMA_RULE_SOURCE_BYTES = 50 * 1_024;
export const MAX_SIGMA_IMPORT_BYTES = 512 * 1_024;

export interface RuleCommandActor {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly ipAddress: string | null;
}

export interface CreateRuleCommand {
  readonly orgId: string;
  readonly yamlContent: string;
  readonly actor: RuleCommandActor;
}

export interface UpdateRuleCommand extends CreateRuleCommand {
  readonly ruleId: string;
}

export interface ChangeRuleStatusCommand {
  readonly orgId: string;
  readonly ruleId: string;
  readonly actor: RuleCommandActor;
}

export type ArchiveRuleCommand = ChangeRuleStatusCommand;

export interface ImportRulesCommand {
  readonly orgId: string;
  readonly yamlContent: string;
  readonly actor: RuleCommandActor;
}

export interface ValidatedSigmaRule {
  readonly sigmaId: string;
  readonly name: string;
  readonly description: string;
  readonly status: "active";
  readonly type: Exclude<RuleType, "sequence">;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly priority: number;
  readonly classUid: number;
  readonly categoryUid: number | null;
  readonly tags: readonly string[];
  readonly falsePositives: readonly string[];
  readonly references: readonly string[];
  readonly compiledHash: string;
  readonly yamlContent: string;
}

export interface CreateRuleResult {
  readonly id: string;
  readonly sigmaId: string;
  readonly name: string;
  readonly status: "active";
  readonly type: Exclude<RuleType, "sequence">;
  readonly severity: RuleSeverity;
  readonly version: number;
  readonly createdAt: Date;
  readonly reloadSignaled: boolean;
}

export interface UpdateRuleResult {
  readonly id: string;
  readonly sigmaId: string;
  readonly name: string;
  readonly status: RuleRecord["status"];
  readonly type: Exclude<RuleType, "sequence">;
  readonly severity: RuleSeverity;
  readonly version: number;
  readonly updatedAt: Date;
  readonly reloadSignaled: boolean;
}

export interface ChangeRuleStatusResult {
  readonly id: string;
  readonly status: "active" | "disabled";
  readonly updatedAt: Date;
  readonly reloadSignaled: boolean;
}

export interface ArchiveRuleResult {
  readonly id: string;
  readonly status: "archived";
  readonly updatedAt: Date;
  readonly reloadSignaled: boolean;
}

export type ImportRuleItemStatus = "imported" | "skipped" | "failed";

export interface ImportRuleItemResult {
  readonly document: number;
  readonly id: string | null;
  readonly name: string | null;
  readonly status: ImportRuleItemStatus;
  readonly code?: string;
  readonly errors?: readonly string[];
}

export interface ImportRulesResult {
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: readonly ImportRuleItemResult[];
  readonly reloadSignaled: boolean;
}

export interface RuleCreationTransaction {
  readonly rules: Pick<IRuleRepository, "create" | "findByName" | "findBySigmaId">;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface RuleCreationUnitOfWork {
  execute<TResult>(
    operation: (transaction: RuleCreationTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface RuleCommandTransaction {
  readonly rules: Pick<
    IRuleRepository,
    | "findByIdForUpdate"
    | "findByName"
    | "updateForOrg"
  >;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface RuleCommandUnitOfWork {
  execute<TResult>(
    operation: (transaction: RuleCommandTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface RuleReloadSignal {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly operation:
    | "created"
    | "updated"
    | "enabled"
    | "disabled"
    | "archived"
    | "imported";
}

export interface RuleReloadSignalPublisher {
  publish(signal: RuleReloadSignal): Promise<boolean>;
}

export class DuplicateSigmaRuleError extends Error {
  public readonly code: "RULE_ID_EXISTS" | "RULE_NAME_EXISTS";

  public constructor(
    public readonly duplicateField: "sigmaId" | "name",
    public readonly duplicateValue: string,
  ) {
    super(
      duplicateField === "sigmaId"
        ? `Rule with Sigma ID ${duplicateValue} already exists.`
        : `Rule with name ${duplicateValue} already exists.`,
    );
    this.name = "DuplicateSigmaRuleError";
    this.code = duplicateField === "sigmaId" ? "RULE_ID_EXISTS" : "RULE_NAME_EXISTS";
  }
}

export class RuleRepositoryUniqueConflictError extends Error {
  public constructor(public readonly constraint: string | null) {
    super("A tenant-unique rule identity already exists.");
    this.name = "RuleRepositoryUniqueConflictError";
  }
}

export class RuleCommandNotFoundError extends Error {
  public readonly code = "RESOURCE_NOT_FOUND" as const;

  public constructor(public readonly ruleId: string) {
    super(`Rule with ID ${ruleId} was not found.`);
    this.name = "RuleCommandNotFoundError";
  }
}

export class CannotModifyBuiltinRuleError extends Error {
  public readonly code = "CANNOT_MODIFY_BUILTIN" as const;

  public constructor(public readonly ruleId: string) {
    super("Built-in rules cannot be modified. Clone the rule to create a custom version.");
    this.name = "CannotModifyBuiltinRuleError";
  }
}

export class CannotDeleteBuiltinRuleError extends Error {
  public readonly code = "CANNOT_DELETE_BUILTIN" as const;

  public constructor(public readonly ruleId: string) {
    super("Built-in rules cannot be deleted.");
    this.name = "CannotDeleteBuiltinRuleError";
  }
}

export class RuleIdentityImmutableError extends Error {
  public readonly code = "RULE_ID_IMMUTABLE" as const;

  public constructor(
    public readonly currentSigmaId: string | null,
    public readonly submittedSigmaId: string,
  ) {
    super("A rule's Sigma ID cannot be changed during update.");
    this.name = "RuleIdentityImmutableError";
  }
}

export class RuleStatusConflictError extends Error {
  public readonly code = "RULE_STATUS_CONFLICT" as const;

  public constructor(
    public readonly currentStatus: RuleRecord["status"],
    public readonly requestedOperation: "update" | "enable" | "disable",
  ) {
    super(`A rule in ${currentStatus} status cannot be ${requestedOperation}d.`);
    this.name = "RuleStatusConflictError";
  }
}

export type CreatedRuleRecord = Pick<
  RuleRecord,
  "id" | "name" | "status" | "type" | "severity" | "version" | "createdAt"
>;

export type UpdatedRuleRecord = Pick<
  RuleRecord,
  "id" | "sigmaId" | "name" | "status" | "type" | "severity" | "version" | "updatedAt"
>;
