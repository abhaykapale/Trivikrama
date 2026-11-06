import type { RuleRecord } from "../../../database/repositories/rules/rule.repository.js";
import type {
  RuleCommandUnitOfWork,
  RuleReloadSignalPublisher,
  UpdateRuleCommand,
  UpdateRuleResult,
  ValidatedSigmaRule,
  UpdatedRuleRecord,
} from "../domain/rule-command.contracts.js";
import {
  CannotModifyBuiltinRuleError,
  DuplicateSigmaRuleError,
  RuleCommandNotFoundError,
  RuleIdentityImmutableError,
  RuleRepositoryUniqueConflictError,
  RuleStatusConflictError,
} from "../domain/rule-command.contracts.js";
import { validateSigmaRuleYaml } from "./validate-sigma-rule.js";

export interface UpdateRuleUseCaseDependencies {
  readonly unitOfWork: RuleCommandUnitOfWork;
  readonly reloadSignals: RuleReloadSignalPublisher;
}

export class UpdateRuleUseCase {
  public constructor(private readonly dependencies: UpdateRuleUseCaseDependencies) {}

  public async execute(command: UpdateRuleCommand): Promise<UpdateRuleResult> {
    const validated = validateSigmaRuleYaml(command.yamlContent);
    let updated: UpdatedRuleRecord;

    try {
      updated = await this.dependencies.unitOfWork.execute(async (transaction) => {
        const current = await transaction.rules.findByIdForUpdate(
          command.ruleId,
          command.orgId,
        );
        if (current === null) throw new RuleCommandNotFoundError(command.ruleId);
        if (current.isBuiltin) throw new CannotModifyBuiltinRuleError(command.ruleId);
        if (current.status === "archived") {
          throw new RuleStatusConflictError(current.status, "update");
        }
        if (current.sigmaId !== validated.sigmaId) {
          throw new RuleIdentityImmutableError(current.sigmaId ?? null, validated.sigmaId);
        }

        const duplicateName = await transaction.rules.findByName(
          validated.name,
          command.orgId,
        );
        if (duplicateName !== null && duplicateName.id !== current.id) {
          throw new DuplicateSigmaRuleError("name", validated.name);
        }

        const nextVersion = current.version + 1;
        const rule = await transaction.rules.updateForOrg(current.id, command.orgId, {
          name: validated.name,
          description: validated.description,
          type: validated.type,
          severity: validated.severity,
          weight: validated.weight,
          yamlContent: validated.yamlContent,
          compiledHash: validated.compiledHash,
          classUid: validated.classUid,
          categoryUid: validated.categoryUid,
          tags: validated.tags,
          falsePositives: validated.falsePositives,
          ruleReferences: validated.references,
          version: nextVersion,
          updatedBy: command.actor.id,
        });
        if (rule === null) throw new RuleCommandNotFoundError(command.ruleId);

        await transaction.audit.create({
          action: "rule_update",
          actorId: command.actor.id,
          actorUsername: command.actor.username,
          actorRole: command.actor.role,
          ipAddress: command.actor.ipAddress,
          targetType: "rule",
          targetId: rule.id,
          targetName: rule.name,
          details: {
            sigmaId: validated.sigmaId,
            version: nextVersion,
            previousHash: current.compiledHash,
            newHash: validated.compiledHash,
          },
          previousState: auditStateFromRecord(current),
          newState: auditStateFromValidated(validated, rule, current.status),
          orgId: command.orgId,
        });

        return rule;
      });
    } catch (error: unknown) {
      if (
        error instanceof RuleRepositoryUniqueConflictError &&
        error.constraint === "uq_rules_org_name_ci"
      ) {
        throw new DuplicateSigmaRuleError("name", validated.name);
      }
      throw error;
    }

    const reloadSignaled = await this.dependencies.reloadSignals.publish({
      organizationId: command.orgId,
      ruleId: updated.id,
      operation: "updated",
    });

    return {
      id: updated.id,
      sigmaId: validated.sigmaId,
      name: updated.name,
      status: updated.status,
      type: validated.type,
      severity: updated.severity,
      version: updated.version,
      updatedAt: updated.updatedAt,
      reloadSignaled,
    };
  }
}

function auditStateFromRecord(rule: RuleRecord): Record<string, unknown> {
  return {
    id: rule.id,
    sigmaId: rule.sigmaId ?? null,
    name: rule.name,
    status: rule.status,
    type: rule.type,
    severity: rule.severity,
    weight: rule.weight,
    classUid: rule.classUid,
    categoryUid: rule.categoryUid,
    tags: [...rule.tags],
    version: rule.version,
    isBuiltin: rule.isBuiltin,
    compiledHash: rule.compiledHash,
  };
}

function auditStateFromValidated(
  validated: ValidatedSigmaRule,
  updated: UpdatedRuleRecord,
  status: RuleRecord["status"],
): Record<string, unknown> {
  return {
    id: updated.id,
    sigmaId: validated.sigmaId,
    name: validated.name,
    status,
    type: validated.type,
    severity: validated.severity,
    weight: validated.weight,
    priority: validated.priority,
    classUid: validated.classUid,
    categoryUid: validated.categoryUid,
    tags: [...validated.tags],
    version: updated.version,
    isBuiltin: false,
    compiledHash: validated.compiledHash,
  };
}
