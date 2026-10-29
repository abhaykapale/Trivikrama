import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { IIncidentRepository } from "../../../database/repositories/incidents/incident.repository.js";
import type { AuthRole } from "../../auth/domain/index.js";
import type { IncidentStatus } from "./incident.contracts.js";

export interface IncidentStatusActor {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly ipAddress: string | null;
}

export interface TransitionIncidentStatusCommand {
  readonly incidentId: string;
  readonly orgId: string;
  readonly status: IncidentStatus;
  readonly actor: IncidentStatusActor;
}

export interface TransitionIncidentStatusResult {
  readonly id: string;
  readonly status: IncidentStatus;
  readonly updatedAt: Date;
}

export interface IncidentStatusTransaction {
  readonly incidents: Pick<
    IIncidentRepository,
    "findByIdForUpdate" | "transitionStatusForOrg"
  >;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface IncidentStatusUnitOfWork {
  execute<TResult>(
    operation: (transaction: IncidentStatusTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}
