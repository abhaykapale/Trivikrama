import type { RuleRecord, RuleStatus } from "../../../database/repositories/rules/rule.repository.js";
import type {
  ChangeRuleStatusCommand,
  ChangeRuleStatusResult,
  RuleCommandUnitOfWork,
  RuleReloadSignalPublisher,
} from "../domain/rule-command.contracts.js";
import {
  RuleCommandNotFoundError,
  RuleStatusConflictError,
} from "../domain/rule-command.contracts.js";

export type RuleStatusOperation = "enable" | "disable";

export interface ChangeRuleStatusUseCaseDependencies {
  readonly unitOfWork: RuleCommandUnitOfWork;
  readonly reloadSignals: RuleReloadSignalPublisher;
}

interface StatusChangeTransactionResult {
  readonly rule: RuleRecord;
  readonly changed: boolean;
}

export class ChangeRuleStatusUseCase {
  private readonly targetStatus: "active" | "disabled";

  public constructor(
    private readonly dependencies: ChangeRuleStatusUseCaseDependencies,
    private readonly operation: RuleStatusOperation,
  ) {
    this.targetStatus = operation === "enable" ? "active" : "disabled";
  }

  public async execute(command: ChangeRuleStatusCommand): Promise<ChangeRuleStatusResult> {
    const transactionResult = await this.dependencies.unitOfWork.execute(
      async (transaction): Promise<StatusChangeTransactionResult> => {
        const current = await transaction.rules.findByIdForUpdate(
          command.ruleId,
          command.orgId,
        );
        if (current === null) throw new RuleCommandNotFoundError(command.ruleId);
        if (current.status === "archived") {
          throw new RuleStatusConflictError(current.status, this.operation);
        }
        if (current.status === this.targetStatus) {
          return { rule: current, changed: false };
        }

        const updated = await transaction.rules.updateForOrg(
          current.id,
          command.orgId,
          { status: this.targetStatus, updatedBy: command.actor.id },
        );
        if (updated === null) throw new RuleCommandNotFoundError(command.ruleId);

        await transaction.audit.create({
          action: this.operation === "enable" ? "rule_enable" : "rule_disable",
          actorId: command.actor.id,
          actorUsername: command.actor.username,
          actorRole: command.actor.role,
          ipAddress: command.actor.ipAddress,
          targetType: "rule",
          targetId: updated.id,
          targetName: updated.name,
          details: { sigmaId: updated.sigmaId ?? null },
          previousState: statusAuditState(current, current.status),
          newState: statusAuditState(updated, this.targetStatus),
          orgId: command.orgId,
        });

        return { rule: updated, changed: true };
      },
    );

    const reloadSignaled = transactionResult.changed
      ? await this.dependencies.reloadSignals.publish({
          organizationId: command.orgId,
          ruleId: transactionResult.rule.id,
          operation: this.operation === "enable" ? "enabled" : "disabled",
        })
      : false;

    return {
      id: transactionResult.rule.id,
      status: this.targetStatus,
      updatedAt: transactionResult.rule.updatedAt,
      reloadSignaled,
    };
  }
}

function statusAuditState(
  rule: RuleRecord,
  status: RuleStatus,
): Record<string, unknown> {
  return {
    id: rule.id,
    sigmaId: rule.sigmaId ?? null,
    name: rule.name,
    status,
    version: rule.version,
    isBuiltin: rule.isBuiltin,
  };
}
