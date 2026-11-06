import type {
  CreateRuleCommand,
  CreateRuleResult,
  RuleCreationUnitOfWork,
  RuleReloadSignalPublisher,
  ValidatedSigmaRule,
  CreatedRuleRecord,
} from "../domain/rule-command.contracts.js";
import {
  DuplicateSigmaRuleError,
  RuleRepositoryUniqueConflictError,
} from "../domain/rule-command.contracts.js";
import { validateSigmaRuleYaml } from "./validate-sigma-rule.js";

export interface CreateRuleUseCaseDependencies {
  readonly unitOfWork: RuleCreationUnitOfWork;
  readonly reloadSignals: RuleReloadSignalPublisher;
}

export class CreateRuleUseCase {
  public constructor(private readonly dependencies: CreateRuleUseCaseDependencies) {}

  public async execute(command: CreateRuleCommand): Promise<CreateRuleResult> {
    const validated = validateSigmaRuleYaml(command.yamlContent);
    let created: CreatedRuleRecord;

    try {
      created = await this.dependencies.unitOfWork.execute(async (transaction) => {
        const duplicateId = await transaction.rules.findBySigmaId(
          validated.sigmaId,
          command.orgId,
        );
        if (duplicateId !== null) {
          throw new DuplicateSigmaRuleError("sigmaId", validated.sigmaId);
        }

        const duplicateName = await transaction.rules.findByName(
          validated.name,
          command.orgId,
        );
        if (duplicateName !== null) {
          throw new DuplicateSigmaRuleError("name", validated.name);
        }

        const rule = await transaction.rules.create({
          sigmaId: validated.sigmaId,
          name: validated.name,
          description: validated.description,
          status: validated.status,
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
          version: 1,
          isBuiltin: false,
          createdBy: command.actor.id,
          updatedBy: command.actor.id,
          orgId: command.orgId,
        });

        await transaction.audit.create({
          action: "rule_create",
          actorId: command.actor.id,
          actorUsername: command.actor.username,
          actorRole: command.actor.role,
          ipAddress: command.actor.ipAddress,
          targetType: "rule",
          targetId: rule.id,
          targetName: rule.name,
          details: {
            sigmaId: validated.sigmaId,
            compiledHash: validated.compiledHash,
          },
          newState: auditState(validated, rule.id),
          orgId: command.orgId,
        });

        return rule;
      });
    } catch (error: unknown) {
      if (error instanceof RuleRepositoryUniqueConflictError) {
        if (error.constraint === "uq_rules_org_name_ci") {
          throw new DuplicateSigmaRuleError("name", validated.name);
        }
        if (error.constraint === "uq_rules_org_sigma_id") {
          throw new DuplicateSigmaRuleError("sigmaId", validated.sigmaId);
        }
      }
      throw error;
    }

    const reloadSignaled = await this.dependencies.reloadSignals.publish({
      organizationId: command.orgId,
      ruleId: created.id,
      operation: "created",
    });

    return {
      id: created.id,
      sigmaId: validated.sigmaId,
      name: created.name,
      status: "active",
      type: validated.type,
      severity: created.severity,
      version: created.version,
      createdAt: created.createdAt,
      reloadSignaled,
    };
  }
}

function auditState(rule: ValidatedSigmaRule, databaseId: string): Record<string, unknown> {
  return {
    id: databaseId,
    sigmaId: rule.sigmaId,
    name: rule.name,
    status: rule.status,
    type: rule.type,
    severity: rule.severity,
    weight: rule.weight,
    priority: rule.priority,
    classUid: rule.classUid,
    categoryUid: rule.categoryUid,
    tags: [...rule.tags],
    version: 1,
    isBuiltin: false,
  };
}
