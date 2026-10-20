import type {
  AlertRecord,
  CreateAlertInput,
  CreateAlertsIfAbsentResult,
  IAlertRepository,
} from "../../../database/repositories/alerts/alert.repository.js";
import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type {
  CreateIncidentEventInput,
  CreateIncidentEventsIfAbsentResult,
  IIncidentEventRepository,
} from "../../../database/repositories/incident-events/incident-event.repository.js";
import type {
  CreateIncidentInput,
  IIncidentRepository,
  IncidentRecord,
  UpdateIncidentInput,
} from "../../../database/repositories/incidents/incident.repository.js";
import type { PaginationOptions } from "../../../database/repositories/common/repository.types.js";
import type { AssetCriticalityResolver } from "./incident-risk.contracts.js";
import type { IIncidentNotificationOutboxRepository } from "../../../database/repositories/incident-notification-outbox/index.js";
import type {
  AiResultSource,
  AlertEntityEventSource,
  RuleAlertSource,
} from "./unified-alert.contracts.js";

export interface IncidentCorrelationEventSource extends AlertEntityEventSource {
  readonly time: Date;
  readonly class_uid: number;
  readonly severity_id: number;
}

export interface CorrelateIncidentAlertsInput {
  readonly orgId: string;
  readonly ruleAlerts: readonly RuleAlertSource[];
  readonly aiResults: readonly AiResultSource[];
  readonly events: readonly IncidentCorrelationEventSource[];
  readonly evaluatedAt: Date;
}

export interface CorrelateIncidentAlertsResult {
  readonly incidentsCreated: number;
  readonly incidentsUpdated: number;
  readonly expiredIncidentsClosed: number;
  readonly alertsAttached: number;
  readonly eventLinksCreated: number;
  readonly notificationsEnqueued: number;
  readonly standaloneAlerts: number;
  readonly replayedAlerts: number;
  readonly incidentIds: readonly string[];
}

export interface IncidentCorrelationTransaction {
  readonly incidents: Pick<
    IIncidentRepository,
    | "create"
    | "findById"
    | "findOpenCandidatesForUpdate"
    | "update"
    | "transitionStatus"
  >;
  readonly alerts: Pick<
    IAlertRepository,
    | "createManyIfAbsent"
    | "findById"
    | "attachToIncidentIfUnassigned"
    | "listByIncident"
  >;
  readonly incidentEvents: Pick<IIncidentEventRepository, "createManyIfAbsent">;
  readonly notifications: Pick<IIncidentNotificationOutboxRepository, "enqueueIfAbsent">;
  readonly audit: Pick<IAuditRepository, "create">;
  readonly assetCriticality: AssetCriticalityResolver;
}

export interface IncidentCorrelationUnitOfWork {
  execute<TResult>(
    operation: (transaction: IncidentCorrelationTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

export type IncidentCorrelationAlertRecord = AlertRecord;
export type IncidentCorrelationCreateAlertInput = CreateAlertInput;
export type IncidentCorrelationCreateAlertsResult = CreateAlertsIfAbsentResult;
export type IncidentCorrelationCreateEventInput = CreateIncidentEventInput;
export type IncidentCorrelationCreateEventsResult = CreateIncidentEventsIfAbsentResult;
export type IncidentCorrelationIncidentRecord = IncidentRecord;
export type IncidentCorrelationCreateIncidentInput = CreateIncidentInput;
export type IncidentCorrelationUpdateIncidentInput = UpdateIncidentInput;
export type IncidentCorrelationPaginationOptions = PaginationOptions;
