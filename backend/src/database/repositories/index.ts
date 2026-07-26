import type { PostgresClient } from "../postgres/index.js";
import { PostgresAssetRepository } from "./assets/index.js";
import { PostgresAuditRepository } from "./audit/index.js";
import { PostgresCollectorStatusRepository } from "./collector-status/index.js";
import { PostgresConfigurationRepository } from "./configuration/index.js";
import { PostgresQueueMetricsRepository } from "./queue-metrics/index.js";
import { PostgresRuleRepository } from "./rules/index.js";
import { PostgresSessionRepository } from "./sessions/index.js";
import { PostgresUserRepository } from "./users/index.js";

export * from "./common/index.js";
export * from "./users/index.js";
export * from "./audit/index.js";
export * from "./configuration/index.js";
export * from "./rules/index.js";
export * from "./sessions/index.js";
export * from "./assets/index.js";
export * from "./collector-status/index.js";
export * from "./queue-metrics/index.js";

export interface PostgresRepositories {
  readonly users: PostgresUserRepository;
  readonly audit: PostgresAuditRepository;
  readonly configuration: PostgresConfigurationRepository;
  readonly rules: PostgresRuleRepository;
  readonly sessions: PostgresSessionRepository;
  readonly assets: PostgresAssetRepository;
  readonly collectorStatus: PostgresCollectorStatusRepository;
  readonly queueMetrics: PostgresQueueMetricsRepository;
}

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
  };
}
