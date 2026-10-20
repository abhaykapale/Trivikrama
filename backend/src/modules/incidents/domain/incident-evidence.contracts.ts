import type {
  OcsfActorDocument,
  OcsfDeviceDocument,
  OcsfEndpointDocument,
} from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
  AlertType,
  AlertSeverity,
} from "../../../database/repositories/alerts/alert.repository.js";
import type { IncidentPaginationView } from "./incident-query.contracts.js";

export interface ListIncidentAlertsQuery {
  readonly incidentId: string;
  readonly orgId: string;
  readonly type?: AlertType;
  readonly page: number;
  readonly limit: number;
}

export interface IncidentAlertView {
  readonly id: string;
  readonly incidentId: string;
  readonly alertType: AlertType;
  readonly ruleId: string | null;
  readonly ruleName: string | null;
  readonly matchedCondition: string | null;
  readonly anomalyScore: number | null;
  readonly confidence: number | null;
  readonly threatCategory: string | null;
  readonly modelVersion: string | null;
  readonly shapValues: Record<string, unknown> | null;
  readonly severity: AlertSeverity;
  readonly weight: number;
  readonly tags: readonly unknown[];
  readonly matchedEventIds: readonly unknown[];
  readonly createdAt: Date;
}

export interface ListIncidentEventsQuery {
  readonly incidentId: string;
  readonly orgId: string;
  readonly page: number;
  readonly limit: number;
}

export interface IncidentEventLinkView {
  readonly eventId: string;
  readonly eventTime: Date;
}

export interface IncidentNormalizedEventView {
  readonly eventId: string;
  readonly classUid: number;
  readonly categoryUid: number;
  readonly severityId: number;
  readonly statusId?: number;
  readonly duration?: number;
  readonly time: Date;
  readonly message: string;
  readonly srcEndpoint?: OcsfEndpointDocument;
  readonly dstEndpoint?: OcsfEndpointDocument;
  readonly actor?: OcsfActorDocument;
  readonly process?: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
  readonly device?: OcsfDeviceDocument;
  readonly metadata: Record<string, unknown>;
  readonly enrichments?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly ingestion: {
    readonly batchId: string;
    readonly collectorId: string;
    readonly ingestedAt: Date;
    readonly pipelineDurationMs?: number;
  };
}

export interface IncidentAlertQueryPage {
  readonly items: readonly IncidentAlertView[];
  readonly total: number;
}

export interface IncidentEventLinkQueryPage {
  readonly items: readonly IncidentEventLinkView[];
  readonly total: number;
}

export interface IIncidentEvidenceQueryRepository {
  listAlerts(input: ListIncidentAlertsQuery): Promise<IncidentAlertQueryPage>;
  listEventLinks(
    input: ListIncidentEventsQuery,
  ): Promise<IncidentEventLinkQueryPage>;
}

export interface ListIncidentAlertsResult {
  readonly data: readonly IncidentAlertView[];
  readonly pagination: IncidentPaginationView;
}

export interface ListIncidentEventsResult {
  readonly data: readonly IncidentNormalizedEventView[];
  readonly pagination: IncidentPaginationView;
}
