import type { Knex } from "knex";

import type { ExistingConfigurationRow,SeedContext, SeedStepResult } from "./seed.types.js";

const DEFAULT_CONFIGURATION_STEP_NAME = "default-configuration";

interface ConfigurationSeedDefinition {
  readonly key: string;
  readonly value: unknown;
  readonly description: string;
  readonly isSensitive: boolean;
}



const DEFAULT_CONFIGURATION: readonly ConfigurationSeedDefinition[] = [
  {
    key: "correlation.time_window_minutes",
    value: 15,
    description:
      "Alerts sharing an entity are correlated when they occur within this many minutes of the incident's last event.",
    isSensitive: false,
  },
  {
    key: "correlation.max_duration_hours",
    value: 24,
    description:
      "Maximum incident duration before the correlator force-closes the old incident and starts a new one.",
    isSensitive: false,
  },
  {
    key: "correlation.extend_on_alert",
    value: true,
    description:
      "Whether each new correlated alert extends the incident correlation window from the alert timestamp.",
    isSensitive: false,
  },
  {
    key: "scoring.weight_rule",
    value: 0.3,
    description: "Composite risk-score weight for rule-based detection confidence.",
    isSensitive: false,
  },
  {
    key: "scoring.weight_ml",
    value: 0.25,
    description: "Composite risk-score weight for AI/ML confidence.",
    isSensitive: false,
  },
  {
    key: "scoring.weight_asset",
    value: 0.2,
    description: "Composite risk-score weight for asset criticality.",
    isSensitive: false,
  },
  {
    key: "scoring.weight_density",
    value: 0.15,
    description: "Composite risk-score weight for alert density.",
    isSensitive: false,
  },
  {
    key: "scoring.weight_killchain",
    value: 0.1,
    description: "Composite risk-score weight for kill-chain progression.",
    isSensitive: false,
  },
  {
    key: "scoring.density_threshold",
    value: 20,
    description: "Alert count that maps to an alert-density component value of 1.0.",
    isSensitive: false,
  },
  {
    key: "scoring.neutral_default",
    value: 0.5,
    description: "Default factor value used when a risk-scoring component is unavailable.",
    isSensitive: false,
  },
  {
    key: "scoring.severity_critical",
    value: 80,
    description: "Minimum composite risk score classified as Critical.",
    isSensitive: false,
  },
  {
    key: "scoring.severity_high",
    value: 60,
    description: "Minimum composite risk score classified as High.",
    isSensitive: false,
  },
  {
    key: "scoring.severity_medium",
    value: 40,
    description: "Minimum composite risk score classified as Medium.",
    isSensitive: false,
  },
  {
    key: "scoring.severity_low",
    value: 20,
    description: "Minimum composite risk score classified as Low.",
    isSensitive: false,
  },
  {
    key: "ai.timeout_ms",
    value: 5_000,
    description: "HTTP request timeout for calls from the backend AI client to the AI Engine.",
    isSensitive: false,
  },
  {
    key: "ai.circuit_failure_threshold",
    value: 5,
    description: "Consecutive AI client failures required to open the circuit breaker.",
    isSensitive: false,
  },
  {
    key: "ai.circuit_cooldown_ms",
    value: 60_000,
    description: "Cooldown duration before an open AI circuit breaker moves to half-open.",
    isSensitive: false,
  },
  {
    key: "ai.circuit_success_threshold",
    value: 2,
    description: "Consecutive half-open successes required to close the AI circuit breaker.",
    isSensitive: false,
  },
  {
    key: "ai.anomaly_threshold",
    value: 0.65,
    description: "AI anomaly score threshold above which an event is classified as anomalous.",
    isSensitive: false,
  },
  {
    key: "ai.batch_size",
    value: 100,
    description: "Maximum number of events sent to the AI Engine in one detection request.",
    isSensitive: false,
  },
  {
    key: "ai.base_url",
    value: "http://ai-engine:8000",
    description: "Internal base URL for the Python FastAPI AI Engine.",
    isSensitive: false,
  },
  {
    key: "retention.mongodb.normalized_events_days",
    value: 90,
    description: "Retention period for MongoDB normalized_events documents.",
    isSensitive: false,
  },
  {
    key: "retention.mongodb.ai_results_days",
    value: 90,
    description: "Retention period for MongoDB ai_results documents.",
    isSensitive: false,
  },
  {
    key: "retention.mongodb.raw_events_archive_days",
    value: 30,
    description: "Retention period for MongoDB raw_events_archive documents.",
    isSensitive: false,
  },
  {
    key: "retention.postgresql.incident_events_months",
    value: 12,
    description: "Retention period for PostgreSQL incident_events partitions.",
    isSensitive: false,
  },
  {
    key: "retention.postgresql.audit_logs_months",
    value: 24,
    description: "Retention period for PostgreSQL audit_logs partitions.",
    isSensitive: false,
  },
  {
    key: "retention.postgresql.queue_metrics_days",
    value: 30,
    description: "Retention period for PostgreSQL monitor.queue_metrics partitions.",
    isSensitive: false,
  },
  {
    key: "retention.cleanup_schedule",
    value: "0 2 * * *",
    description: "Cron schedule for PostgreSQL retention cleanup jobs.",
    isSensitive: false,
  },
];

export async function seedDefaultConfiguration(
  context: SeedContext,
): Promise<SeedStepResult> {
  const existingKeys = await readExistingConfigurationKeys(context.trx);
  const missingConfiguration = DEFAULT_CONFIGURATION.filter(
    (item) => !existingKeys.has(item.key),
  );

  if (missingConfiguration.length === 0) {
    return {
      name: DEFAULT_CONFIGURATION_STEP_NAME,
      status: "skipped",
      inserted: 0,
      updated: 0,
      skipped: DEFAULT_CONFIGURATION.length,
      message:
        "All documented default configuration keys already exist. Existing values were preserved.",
    };
  }

  await context.trx("public.configuration").insert(
    missingConfiguration.map((item) => ({
      key: item.key,
      value: JSON.stringify(item.value),
      description: item.description,
      is_sensitive: item.isSensitive,
      updated_by: null,
    })),
  );

  await writeConfigurationSeedAuditLog(context, missingConfiguration, existingKeys);

  return {
    name: DEFAULT_CONFIGURATION_STEP_NAME,
    status: "success",
    inserted: missingConfiguration.length,
    updated: 0,
    skipped: DEFAULT_CONFIGURATION.length - missingConfiguration.length,
    message:
      "Documented default configuration values inserted. Existing configuration values were preserved and not overwritten.",
  };
}

async function readExistingConfigurationKeys(
  trx: Knex.Transaction,
): Promise<ReadonlySet<string>> {
  const rows = await trx<ExistingConfigurationRow>("public.configuration").select(
    "key",
  );

  return new Set(rows.map((row) => row.key));
}

async function writeConfigurationSeedAuditLog(
  context: SeedContext,
  insertedConfiguration: readonly ConfigurationSeedDefinition[],
  existingKeys: ReadonlySet<string>,
): Promise<void> {
  await context.trx("audit.audit_logs").insert({
    action: "config_change",
    actor_id: null,
    actor_username: "system_seed",
    actor_role: null,
    target_type: "configuration",
    target_id: "default-configuration",
    target_name: "Default configuration seed",
    details: {
      source: "database_seed",
      seed_step: DEFAULT_CONFIGURATION_STEP_NAME,
      inserted_keys: insertedConfiguration.map((item) => item.key),
      preserved_existing_keys: DEFAULT_CONFIGURATION.filter((item) =>
        existingKeys.has(item.key),
      ).map((item) => item.key),
    },
    new_state: insertedConfiguration.reduce<Record<string, unknown>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {}),
    org_id: context.initialAdmin.orgId,
  });
}
