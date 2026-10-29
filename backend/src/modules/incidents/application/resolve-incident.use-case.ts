import type { RepositoryClock } from "../../../database/repositories/common/index.js";
import { systemClock } from "../../../database/repositories/common/index.js";
import { InvalidIncidentStatusTransitionError } from "./transition-incident-status.use-case.js";
import type {
  IncidentResolutionUnitOfWork,
  ResolveIncidentCommand,
  ResolveIncidentResult,
} from "../domain/incident-resolution.contracts.js";

export class ResolveIncidentUseCase {
  public constructor(
    private readonly unitOfWork: IncidentResolutionUnitOfWork,
    private readonly clock: RepositoryClock = systemClock,
  ) {}

  public execute(
    command: ResolveIncidentCommand,
  ): Promise<ResolveIncidentResult | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const current = await transaction.incidents.findByIdForUpdate(
        command.incidentId,
        command.orgId,
      );
      if (current === null) return null;

      if (current.status !== "investigating") {
        throw new InvalidIncidentStatusTransitionError(
          current.status,
          "resolved",
        );
      }

      const resolvedAt = this.clock.now();
      const updated = await transaction.incidents.transitionStatusForOrg(
        current.id,
        command.orgId,
        { status: "resolved", resolvedAt, closedAt: null },
      );
      if (updated === null) {
        throw new Error(
          `Incident ${current.id} disappeared during its locked resolution.`,
        );
      }

      const note = command.note === undefined
        ? null
        : await transaction.notes.create({
            incidentId: current.id,
            authorId: command.actor.id,
            content: command.note,
          });

      await transaction.audit.create({
        action: "incident_resolve",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "incident",
        targetId: current.id,
        targetName: current.title,
        details: {
          resolution: command.resolution,
          noteId: note?.id ?? null,
          note: note?.content ?? null,
        },
        previousState: {
          status: current.status,
          resolvedAt: current.resolvedAt?.toISOString() ?? null,
        },
        newState: {
          status: updated.status,
          resolution: command.resolution,
          resolvedAt: updated.resolvedAt?.toISOString() ?? null,
        },
        orgId: command.orgId,
      });

      if (updated.status !== "resolved" || updated.resolvedAt === null) {
        throw new Error(
          `Incident ${current.id} returned an invalid resolved state.`,
        );
      }

      return {
        id: updated.id,
        status: "resolved",
        resolution: command.resolution,
        resolvedAt: updated.resolvedAt,
        updatedAt: updated.updatedAt,
      };
    });
  }
}
