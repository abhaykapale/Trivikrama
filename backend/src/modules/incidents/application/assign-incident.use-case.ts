import type {
  AssignIncidentCommand,
  AssignIncidentResult,
  IncidentAssignmentUnitOfWork,
} from "../domain/incident-assignment.contracts.js";

export class IncidentAssigneeNotAvailableError extends Error {
  public readonly code = "ASSIGNEE_NOT_AVAILABLE";

  public constructor(public readonly assigneeId: string) {
    super("The requested incident assignee was not found or is inactive.");
    this.name = "IncidentAssigneeNotAvailableError";
  }
}

export class AssignIncidentUseCase {
  public constructor(private readonly unitOfWork: IncidentAssignmentUnitOfWork) {}

  public execute(
    command: AssignIncidentCommand,
  ): Promise<AssignIncidentResult | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const current = await transaction.incidents.findByIdForUpdate(
        command.incidentId,
        command.orgId,
      );
      if (current === null) return null;

      let assigneeUsername: string | null = null;
      if (command.assignedTo !== null) {
        const assignee = await transaction.users.findByIdAndOrg(
          command.assignedTo,
          command.orgId,
        );
        if (assignee === null || !assignee.isActive) {
          throw new IncidentAssigneeNotAvailableError(command.assignedTo);
        }
        assigneeUsername = assignee.username;
      }

      if (current.assignedTo === command.assignedTo) {
        return {
          id: current.id,
          assignedTo: current.assignedTo,
          updatedAt: current.updatedAt,
        };
      }

      const updated = await transaction.incidents.assignForOrg(
        current.id,
        command.orgId,
        command.assignedTo,
      );
      if (updated === null) {
        throw new Error(
          `Incident ${current.id} disappeared during its locked assignment.`,
        );
      }

      await transaction.audit.create({
        action: "incident_assign",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "incident",
        targetId: current.id,
        targetName: current.title,
        details: {
          previousAssigneeId: current.assignedTo,
          newAssigneeId: updated.assignedTo,
          newAssigneeUsername: assigneeUsername,
        },
        previousState: { assignedTo: current.assignedTo },
        newState: { assignedTo: updated.assignedTo },
        orgId: command.orgId,
      });

      return {
        id: updated.id,
        assignedTo: updated.assignedTo,
        updatedAt: updated.updatedAt,
      };
    });
  }
}
