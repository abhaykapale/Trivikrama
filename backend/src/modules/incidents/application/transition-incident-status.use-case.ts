import type { RepositoryClock } from "../../../database/repositories/common/index.js";
import { systemClock } from "../../../database/repositories/common/index.js";
import type {
  IncidentStatusUnitOfWork,
  TransitionIncidentStatusCommand,
  TransitionIncidentStatusResult,
} from "../domain/incident-status.contracts.js";
import type { IncidentStatus } from "../domain/incident.contracts.js";

const ALLOWED_TRANSITIONS: Readonly<
  Record<IncidentStatus, ReadonlySet<IncidentStatus>>
> = {
  open: new Set(["investigating", "closed"]),
  investigating: new Set(["resolved", "open"]),
  resolved: new Set(["closed", "investigating"]),
  closed: new Set(),
};

export class InvalidIncidentStatusTransitionError extends Error {
  public readonly code = "INVALID_STATUS_TRANSITION";

  public constructor(
    public readonly currentStatus: IncidentStatus,
    public readonly requestedStatus: IncidentStatus,
  ) {
    super(`Cannot transition from '${currentStatus}' to '${requestedStatus}'`);
    this.name = "InvalidIncidentStatusTransitionError";
  }
}

export class TransitionIncidentStatusUseCase {
  public constructor(
    private readonly unitOfWork: IncidentStatusUnitOfWork,
    private readonly clock: RepositoryClock = systemClock,
  ) {}

  public execute(
    command: TransitionIncidentStatusCommand,
  ): Promise<TransitionIncidentStatusResult | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const current = await transaction.incidents.findByIdForUpdate(
        command.incidentId,
        command.orgId,
      );
      if (current === null) return null;

      if (!ALLOWED_TRANSITIONS[current.status].has(command.status)) {
        throw new InvalidIncidentStatusTransitionError(
          current.status,
          command.status,
        );
      }

      const transitionedAt = this.clock.now();
      const timestamps = transitionTimestamps(
        current.status,
        current.resolvedAt,
        command.status,
        transitionedAt,
      );
      const updated = await transaction.incidents.transitionStatusForOrg(
        current.id,
        command.orgId,
        {
          status: command.status,
          resolvedAt: timestamps.resolvedAt,
          closedAt: timestamps.closedAt,
        },
      );
      if (updated === null) {
        throw new Error(
          `Incident ${current.id} disappeared during its locked status transition.`,
        );
      }

      await transaction.audit.create({
        action: "incident_status_change",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "incident",
        targetId: current.id,
        targetName: current.title,
        details: {
          field: "status",
          previousValue: current.status,
          newValue: command.status,
        },
        previousState: statusState(
          current.status,
          current.resolvedAt,
          current.closedAt,
        ),
        newState: statusState(
          updated.status,
          updated.resolvedAt,
          updated.closedAt,
        ),
        orgId: command.orgId,
      });

      return {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      };
    });
  }
}

function transitionTimestamps(
  currentStatus: IncidentStatus,
  currentResolvedAt: Date | null,
  requestedStatus: IncidentStatus,
  transitionedAt: Date,
): { readonly resolvedAt: Date | null; readonly closedAt: Date | null } {
  if (requestedStatus === "resolved") {
    return { resolvedAt: transitionedAt, closedAt: null };
  }
  if (requestedStatus === "closed") {
    return {
      resolvedAt: currentStatus === "resolved" ? currentResolvedAt : null,
      closedAt: transitionedAt,
    };
  }
  return { resolvedAt: null, closedAt: null };
}

function statusState(
  status: IncidentStatus,
  resolvedAt: Date | null,
  closedAt: Date | null,
): Record<string, unknown> {
  return {
    status,
    resolvedAt: resolvedAt?.toISOString() ?? null,
    closedAt: closedAt?.toISOString() ?? null,
  };
}
