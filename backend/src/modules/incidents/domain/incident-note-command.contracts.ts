import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { IIncidentNoteRepository } from "../../../database/repositories/incident-notes/incident-note.repository.js";
import type { IIncidentRepository } from "../../../database/repositories/incidents/incident.repository.js";
import type { AuthRole } from "../../auth/domain/index.js";

export interface IncidentNoteActor {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly ipAddress: string | null;
}

export interface AddIncidentNoteCommand {
  readonly incidentId: string;
  readonly orgId: string;
  readonly content: string;
  readonly actor: IncidentNoteActor;
}

export interface AddIncidentNoteResult {
  readonly id: string;
  readonly incidentId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly content: string;
  readonly createdAt: Date;
}

export interface IncidentNoteCommandTransaction {
  readonly incidents: Pick<IIncidentRepository, "findByIdForUpdate">;
  readonly notes: Pick<IIncidentNoteRepository, "create">;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface IncidentNoteCommandUnitOfWork {
  execute<TResult>(
    operation: (transaction: IncidentNoteCommandTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}
