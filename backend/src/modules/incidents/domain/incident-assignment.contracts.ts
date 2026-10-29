import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { IIncidentRepository } from "../../../database/repositories/incidents/incident.repository.js";
import type { IUserRepository } from "../../../database/repositories/users/user.repository.js";
import type { AuthRole } from "../../auth/domain/index.js";

export interface IncidentAssignmentActor {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly ipAddress: string | null;
}

export interface AssignIncidentCommand {
  readonly incidentId: string;
  readonly orgId: string;
  readonly assignedTo: string | null;
  readonly actor: IncidentAssignmentActor;
}

export interface AssignIncidentResult {
  readonly id: string;
  readonly assignedTo: string | null;
  readonly updatedAt: Date;
}

export interface IncidentAssignmentTransaction {
  readonly incidents: Pick<
    IIncidentRepository,
    "findByIdForUpdate" | "assignForOrg"
  >;
  readonly users: Pick<IUserRepository, "findByIdAndOrg">;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface IncidentAssignmentUnitOfWork {
  execute<TResult>(
    operation: (transaction: IncidentAssignmentTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}
