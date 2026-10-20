import type { AlertType } from "../../../database/repositories/alerts/index.js";
import type { IncidentSeverity } from "./incident.contracts.js";

export type IncidentTimelineEntryType = "event" | "alert" | "action";

export interface IncidentTimelineEventEntry {
  readonly id: string;
  readonly incidentId: string;
  readonly type: "event";
  readonly timestamp: Date;
  readonly eventId: string;
  readonly eventClassUid: number | null;
  readonly eventMessage: string | null;
  readonly eventSeverity: number | null;
}

export interface IncidentTimelineAlertEntry {
  readonly id: string;
  readonly incidentId: string;
  readonly type: "alert";
  readonly timestamp: Date;
  readonly alertId: string;
  readonly alertType: AlertType;
  readonly alertSeverity: IncidentSeverity;
  readonly alertTitle: string;
  readonly anomalyScore: number | null;
}

export interface IncidentTimelineActionEntry {
  readonly id: string;
  readonly incidentId: string;
  readonly type: "action";
  readonly timestamp: Date;
  readonly action: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly previousValue: string | null;
  readonly newValue: string | null;
  readonly noteContent: string | null;
}

export type IncidentTimelineEntry =
  | IncidentTimelineEventEntry
  | IncidentTimelineAlertEntry
  | IncidentTimelineActionEntry;

export type IncidentTimelineStoredEntry =
  | Omit<IncidentTimelineEventEntry, "incidentId" | "eventMessage">
  | Omit<IncidentTimelineAlertEntry, "incidentId">
  | Omit<IncidentTimelineActionEntry, "incidentId">;

export interface GetIncidentTimelineQuery {
  readonly incidentId: string;
  readonly orgId: string;
  readonly type?: IncidentTimelineEntryType;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly limit: number;
}

export interface IncidentTimelinePage {
  readonly items: readonly IncidentTimelineStoredEntry[];
  readonly total: number;
}

export interface IIncidentTimelineRepository {
  list(input: GetIncidentTimelineQuery): Promise<IncidentTimelinePage>;
}

export interface GetIncidentTimelineResult {
  readonly data: readonly IncidentTimelineEntry[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
  };
}
