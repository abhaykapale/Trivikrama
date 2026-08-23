import type { PostgresClient } from "../postgres/index.js";
import type { IAlertRepository } from "./alerts/index.js";
import { PostgresAlertRepository } from "./alerts/index.js";
import type { IAssetRepository } from "./assets/index.js";
import { PostgresAssetRepository } from "./assets/index.js";
import type { IAuditRepository } from "./audit/index.js";
import { PostgresAuditRepository } from "./audit/index.js";
import type { ICollectorStatusRepository } from "./collector-status/index.js";
import { PostgresCollectorStatusRepository } from "./collector-status/index.js";
import type { TransactionClient } from "./common/index.js";
import type { IConfigurationRepository } from "./configuration/index.js";
import { PostgresConfigurationRepository } from "./configuration/index.js";
import type { IIncidentEventRepository } from "./incident-events/index.js";
import { PostgresIncidentEventRepository } from "./incident-events/index.js";
import type { IIncidentNoteRepository } from "./incident-notes/index.js";
import { PostgresIncidentNoteRepository } from "./incident-notes/index.js";
import type { IIncidentRepository } from "./incidents/index.js";
import { PostgresIncidentRepository } from "./incidents/index.js";
import type { IQueueMetricsRepository } from "./queue-metrics/index.js";
import { PostgresQueueMetricsRepository } from "./queue-metrics/index.js";
import type { IRuleRepository } from "./rules/index.js";
import { PostgresRuleRepository } from "./rules/index.js";
import type { ISessionRepository } from "./sessions/index.js";
import { PostgresSessionRepository } from "./sessions/index.js";
import type { IUserRepository } from "./users/index.js";
import { PostgresUserRepository } from "./users/index.js";

export const POSTGRES_REPOSITORY_NAMES = [
  "users",
  "audit",
  "configuration",
  "rules",
  "sessions",
  "assets",
  "collectorStatus",
  "queueMetrics",
  "incidents",
  "alerts",
  "incidentNotes",
  "incidentEvents",
] as const;

export type PostgresRepositoryName = (typeof POSTGRES_REPOSITORY_NAMES)[number];

export interface RelationalRepositories {
  readonly users: IUserRepository;
  readonly audit: IAuditRepository;
  readonly configuration: IConfigurationRepository;
  readonly rules: IRuleRepository;
  readonly sessions: ISessionRepository;
  readonly assets: IAssetRepository;
  readonly collectorStatus: ICollectorStatusRepository;
  readonly queueMetrics: IQueueMetricsRepository;
  readonly incidents: IIncidentRepository;
  readonly alerts: IAlertRepository;
  readonly incidentNotes: IIncidentNoteRepository;
  readonly incidentEvents: IIncidentEventRepository;
}

export type PostgresRepositories = RelationalRepositories;

export function createPostgresRepositories(client: PostgresClient): PostgresRepositories {
  return {
    users: new PostgresUserRepository(client),
    audit: new PostgresAuditRepository(client),
    configuration: new PostgresConfigurationRepository(client),
    rules: new PostgresRuleRepository(client),
    sessions: new PostgresSessionRepository(client),
    assets: new PostgresAssetRepository(client),
    collectorStatus: new PostgresCollectorStatusRepository(client),
    queueMetrics: new PostgresQueueMetricsRepository(client),
    incidents: new PostgresIncidentRepository(client),
    alerts: new PostgresAlertRepository(client),
    incidentNotes: new PostgresIncidentNoteRepository(client),
    incidentEvents: new PostgresIncidentEventRepository(client),
  };
}

export function createTransactionalPostgresRepositories(
  transaction: TransactionClient,
): PostgresRepositories {
  return {
    users: new PostgresUserRepository(transaction),
    audit: new PostgresAuditRepository(transaction),
    configuration: new PostgresConfigurationRepository(transaction),
    rules: new PostgresRuleRepository(transaction),
    sessions: new PostgresSessionRepository(transaction),
    assets: new PostgresAssetRepository(transaction),
    collectorStatus: new PostgresCollectorStatusRepository(transaction),
    queueMetrics: new PostgresQueueMetricsRepository(transaction),
    incidents: new PostgresIncidentRepository(transaction),
    alerts: new PostgresAlertRepository(transaction),
    incidentNotes: new PostgresIncidentNoteRepository(transaction),
    incidentEvents: new PostgresIncidentEventRepository(transaction),
  };
}

export function bindPostgresRepositoriesToTransaction(
  repositories: PostgresRepositories,
  transaction: TransactionClient,
): PostgresRepositories {
  return {
    users: repositories.users.withTransaction(transaction),
    audit: repositories.audit.withTransaction(transaction),
    configuration: repositories.configuration.withTransaction(transaction),
    rules: repositories.rules.withTransaction(transaction),
    sessions: repositories.sessions.withTransaction(transaction),
    assets: repositories.assets.withTransaction(transaction),
    collectorStatus: repositories.collectorStatus.withTransaction(transaction),
    queueMetrics: repositories.queueMetrics.withTransaction(transaction),
    incidents: repositories.incidents.withTransaction(transaction),
    alerts: repositories.alerts.withTransaction(transaction),
    incidentNotes: repositories.incidentNotes.withTransaction(transaction),
    incidentEvents: repositories.incidentEvents.withTransaction(transaction),
  };
}

export function assertPostgresRepositoryCoverage(
  repositories: Partial<Record<PostgresRepositoryName, unknown>>,
): void {
  const missing = POSTGRES_REPOSITORY_NAMES.filter((name) => repositories[name] === undefined);

  if (missing.length > 0) {
    throw new Error(`PostgreSQL repository factory is missing: ${missing.join(", ")}.`);
  }
}
