import type {
  ArchiveRuleCommand,
  ArchiveRuleResult,
  RuleCommandUnitOfWork,
  RuleReloadSignalPublisher,
} from "../domain/rule-command.contracts.js";
import {
  CannotDeleteBuiltinRuleError,
  RuleCommandNotFoundError,
} from "../domain/rule-command.contracts.js";

export interface ArchiveRuleUseCaseDependencies {
  readonly unitOfWork: RuleCommandUnitOfWork;
  readonly reloadSignals: RuleReloadSignalPublisher;
}

export class ArchiveRuleUseCase {
  public constructor(private readonly dependencies: ArchiveRuleUseCaseDependencies) {}

  public async execute(command: ArchiveRuleCommand): Promise<ArchiveRuleResult> {
    const transactionResult = await this.dependencies.unitOfWork.execute(
      async (transaction) => {
        const current = await transaction.rules.findByIdForUpdate(
          command.ruleId,
          command.orgId,
        );
        if (current === null) throw new RuleCommandNotFoundError(command.ruleId);
        if (current.isBuiltin) throw new CannotDeleteBuiltinRuleError(command.ruleId);
        if (current.status === "archived") {
          return { rule: current, changed: false } as const;
        }

        const archived = await transaction.rules.updateForOrg(
          current.id,
          command.orgId,
          { status: "archived", updatedBy: command.actor.id },
        );
        if (archived === null) throw new RuleCommandNotFoundError(command.ruleId);

        await transaction.audit.create({
          action: "rule_delete",
          actorId: command.actor.id,
          actorUsername: command.actor.username,
          actorRole: command.actor.role,
          ipAddress: command.actor.ipAddress,
          targetType: "rule",
          targetId: archived.id,
          targetName: archived.name,
          details: { sigmaId: archived.sigmaId ?? null, softDelete: true },
          previousState: {
            id: current.id,
            sigmaId: current.sigmaId ?? null,
            name: current.name,
            status: current.status,
            version: current.version,
            isBuiltin: current.isBuiltin,
          },
          newState: {
            id: archived.id,
            sigmaId: archived.sigmaId ?? null,
            name: archived.name,
            status: "archived",
            version: archived.version,
            isBuiltin: false,
          },
          orgId: command.orgId,
        });

        return { rule: archived, changed: true } as const;
      },
    );

    const reloadSignaled = transactionResult.changed
      ? await this.dependencies.reloadSignals.publish({
          organizationId: command.orgId,
          ruleId: transactionResult.rule.id,
          operation: "archived",
        })
      : false;

    return {
      id: transactionResult.rule.id,
      status: "archived",
      updatedAt: transactionResult.rule.updatedAt,
      reloadSignaled,
    };
  }
}
