import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { IIncidentNoteRepository } from "../../../database/repositories/incident-notes/incident-note.repository.js";
import type { IIncidentRepository } from "../../../database/repositories/incidents/incident.repository.js";
import type { AuthRole } from "../../auth/domain/index.js";

export const INCIDENT_RESOLUTIONS = [
  "tp_mitigated",
  "tp_accepted",
  "fp_rule_tuning",
  "fp_ai_noise",
  "fp_known",
  "duplicate",
  "informational",
] as const;

export type IncidentResolution = (typeof INCIDENT_RESOLUTIONS)[number];

export interface IncidentResolutionActor {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly ipAddress: string | null;
}

export interface ResolveIncidentCommand {
  readonly incidentId: string;
  readonly orgId: string;
  readonly resolution: IncidentResolution;
  readonly note?: string;
  readonly actor: IncidentResolutionActor;
}

export interface ResolveIncidentResult {
  readonly id: string;
  readonly status: "resolved";
  readonly resolution: IncidentResolution;
  readonly resolvedAt: Date;
  readonly updatedAt: Date;
}

export interface IncidentResolutionTransaction {
  readonly incidents: Pick<
    IIncidentRepository,
    "findByIdForUpdate" | "transitionStatusForOrg"
  >;
  readonly notes: Pick<IIncidentNoteRepository, "create">;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface IncidentResolutionUnitOfWork {
  execute<TResult>(
    operation: (transaction: IncidentResolutionTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}
