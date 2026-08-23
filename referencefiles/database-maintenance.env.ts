import "dotenv/config";

import { z } from "zod";

import type { DatabaseMaintenanceConfig } from "../database/maintenance/maintenance.types.js";

const databaseMaintenanceEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  POSTGRES_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_MAINTENANCE_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  DB_MAINTENANCE_FUTURE_MONTHLY_PARTITIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .default(3),
  DB_MAINTENANCE_FUTURE_WEEKLY_PARTITIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(104)
    .default(8),

  DB_MAINTENANCE_AUDIT_LOGS_RETENTION_MONTHS: z.coerce
    .number()
    .int()
    .min(1)
    .max(120)
    .default(24),
  DB_MAINTENANCE_INCIDENT_EVENTS_RETENTION_MONTHS: z.coerce
    .number()
    .int()
    .min(1)
    .max(120)
    .default(12),
  DB_MAINTENANCE_QUEUE_METRICS_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(30),

  DB_MAINTENANCE_ALLOW_DESTRUCTIVE_RETENTION: z
    .enum(["true", "false"])
    .default("false"),
});

const DEFAULT_VACUUM_ANALYZE_TABLES = [
  "public.incidents",
  "public.alerts",
  "public.rules",
  "public.users",
  "public.assets",
  "public.configuration",
  "monitor.collector_status",
  "monitor.queue_metrics",
] as const;

export function loadDatabaseMaintenanceConfig(): DatabaseMaintenanceConfig {
  const parsed = databaseMaintenanceEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Database maintenance environment validation failed: ${JSON.stringify(
        parsed.error.format(),
      )}`,
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
    connectionTimeoutMs: env.POSTGRES_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: env.POSTGRES_QUERY_TIMEOUT_MS,
    lockTimeoutMs: env.DB_MAINTENANCE_LOCK_TIMEOUT_MS,
    futureMonthlyPartitions: env.DB_MAINTENANCE_FUTURE_MONTHLY_PARTITIONS,
    futureWeeklyPartitions: env.DB_MAINTENANCE_FUTURE_WEEKLY_PARTITIONS,
    auditLogsRetentionMonths: env.DB_MAINTENANCE_AUDIT_LOGS_RETENTION_MONTHS,
    incidentEventsRetentionMonths:
      env.DB_MAINTENANCE_INCIDENT_EVENTS_RETENTION_MONTHS,
    queueMetricsRetentionDays: env.DB_MAINTENANCE_QUEUE_METRICS_RETENTION_DAYS,
    allowDestructiveRetention:
      env.DB_MAINTENANCE_ALLOW_DESTRUCTIVE_RETENTION === "true",
    vacuumAnalyzeTables: DEFAULT_VACUUM_ANALYZE_TABLES,
  };
}
