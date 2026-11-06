import { z, type ZodType } from "zod";
import { ConfigurationKeyNotManagedError, InvalidConfigurationValueError } from "../domain/configuration.contracts.js";

const integer = (min: number, max: number) => z.number().int().min(min).max(max);
const probability = z.number().min(0).max(1);
const riskScore = z.number().min(0).max(100);
const httpUrl = z.string().trim().min(1).max(2_048).url().superRefine((value, context) => {
  let url: URL;
  try { url = new URL(value); }
  catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") context.addIssue({ code: "custom", message: "URL protocol must be http or https" });
  if (url.username.length > 0 || url.password.length > 0) context.addIssue({ code: "custom", message: "URL must not contain credentials" });
});
const cron = z.string().trim().min(9).max(100).regex(/^[0-9*/?,\-]+(?: [0-9*/?,\-]+){4}$/u, "must be a five-field cron expression");

const POLICIES: Readonly<Record<string, ZodType>> = {
  "correlation.time_window_minutes": integer(1, 1_440),
  "correlation.max_duration_hours": integer(1, 720),
  "correlation.extend_on_alert": z.boolean(),
  "scoring.weight_rule": probability,
  "scoring.weight_ml": probability,
  "scoring.weight_asset": probability,
  "scoring.weight_density": probability,
  "scoring.weight_killchain": probability,
  "scoring.density_threshold": integer(1, 1_000_000),
  "scoring.neutral_default": probability,
  "scoring.severity_critical": riskScore,
  "scoring.severity_high": riskScore,
  "scoring.severity_medium": riskScore,
  "scoring.severity_low": riskScore,
  "ai.timeout_ms": integer(100, 120_000),
  "ai.circuit_failure_threshold": integer(1, 100),
  "ai.circuit_cooldown_ms": integer(1_000, 3_600_000),
  "ai.circuit_success_threshold": integer(1, 100),
  "ai.anomaly_threshold": probability,
  "ai.batch_size": integer(1, 1_000),
  "ai.base_url": httpUrl,
  "retention.mongodb.normalized_events_days": integer(1, 3_650),
  "retention.mongodb.ai_results_days": integer(1, 3_650),
  "retention.mongodb.raw_events_archive_days": integer(1, 3_650),
  "retention.postgresql.incident_events_months": integer(1, 120),
  "retention.postgresql.audit_logs_months": integer(1, 120),
  "retention.postgresql.queue_metrics_days": integer(1, 3_650),
  "retention.cleanup_schedule": cron,
};

export function validateConfigurationValue(key: string, value: unknown): unknown {
  const policy = POLICIES[key];
  if (policy === undefined) throw new ConfigurationKeyNotManagedError(key);
  const parsed = policy.safeParse(value);
  if (!parsed.success) throw new InvalidConfigurationValueError(key, parsed.error.issues.map((issue) => issue.message));
  return parsed.data;
}

export function isManagedConfigurationKey(key: string): boolean { return POLICIES[key] !== undefined; }
