import type { IncidentSeverity } from "../domain/incident.contracts.js";
import type {
  AiResultSource,
  MergeAlertSourcesInput,
  MergeAlertSourcesResult,
  RuleAlertSource,
  UnifiedAiAlert,
  UnifiedRuleAlert,
} from "../domain/unified-alert.contracts.js";
import { createDeterministicAiAlertId } from "./unified-alert-id.js";

export class UnifiedAlertMerger {
  public merge(input: MergeAlertSourcesInput): MergeAlertSourcesResult {
    const orgId = requireOrgId(input.orgId);
    const ruleAlerts = input.ruleAlerts.map((alert) =>
      normalizeRuleAlert(orgId, alert),
    );
    const anomalousResults = input.aiResults.filter((result) => result.is_anomaly);
    const aiAlerts = anomalousResults.map((result) =>
      normalizeAiAlert(orgId, result),
    );

    return Object.freeze({
      alerts: Object.freeze([...ruleAlerts, ...aiAlerts]),
      ruleAlertsMerged: ruleAlerts.length,
      aiAlertsMerged: aiAlerts.length,
      nonAnomalousAiResultsIgnored: input.aiResults.length - anomalousResults.length,
    });
  }
}

function normalizeRuleAlert(
  orgId: string,
  alert: RuleAlertSource,
): UnifiedRuleAlert {
  if (alert.orgId !== orgId) {
    throw new Error(`Rule alert ${alert.id} crossed the incident organization boundary.`);
  }
  if (alert.alertType !== "rule") {
    throw new Error(`Alert ${alert.id} is not a rule alert.`);
  }

  const ruleId = requireNonBlank(alert.ruleId, "ruleId");
  const ruleName = requireNonBlank(alert.ruleName, "ruleName");
  const matchedCondition = requireNonBlank(
    alert.matchedCondition,
    "matchedCondition",
  );

  return Object.freeze({
    id: requireNonBlank(alert.id, "alert.id"),
    type: "rule",
    orgId,
    ruleId,
    ruleName,
    matchedCondition,
    severity: alert.severity,
    weight: requireProbability(alert.weight, "alert.weight"),
    tags: normalizeStringArray(alert.tags, "alert.tags"),
    matchedEventIds: normalizeEventIds(alert.matchedEventIds),
    timestamp: requireDate(alert.createdAt, "alert.createdAt"),
    entities: Object.freeze([]),
    metadata: Object.freeze({ ...alert.metadata }),
  });
}

function normalizeAiAlert(orgId: string, result: AiResultSource): UnifiedAiAlert {
  if (result.org_id !== orgId) {
    throw new Error(
      `AI result ${result.event_id} crossed the incident organization boundary.`,
    );
  }

  const eventId = requireNonBlank(result.event_id, "event_id");
  const modelName = requireNonBlank(result.model_name, "model_name");
  const modelVersion = requireNonBlank(result.model_version, "model_version");
  const anomalyScore = requireProbability(result.anomaly_score, "anomaly_score");
  const confidence =
    result.confidence === undefined
      ? null
      : requireProbability(result.confidence, "confidence");

  return Object.freeze({
    id: createDeterministicAiAlertId({
      orgId,
      eventId,
      modelName,
      modelVersion,
    }),
    type: "ai",
    orgId,
    modelName,
    modelVersion,
    anomalyScore,
    confidence,
    severity: classifyAiSeverity(anomalyScore),
    weight: anomalyScore,
    tags: Object.freeze([]),
    matchedEventIds: Object.freeze([eventId]),
    timestamp: requireDate(result.created_at, "created_at"),
    entities: Object.freeze([]),
    metadata: Object.freeze({
      batchId: result.batch_id,
      threatCategory: result.threat_category,
      threatConfidence: result.threat_confidence,
      shapExplanation: result.shap_explanation,
      inputFeatures: result.input_features,
      processingTimeMs: result.processing_time_ms,
      usedFallback: result.used_fallback ?? false,
    }),
  });
}

function classifyAiSeverity(score: number): IncidentSeverity {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.4) return "medium";
  if (score >= 0.2) return "low";
  return "informational";
}

function normalizeEventIds(values: readonly unknown[]): readonly string[] {
  const normalized = normalizeStringArray(values, "matchedEventIds");
  if (normalized.length === 0) {
    throw new Error("Unified rule alert must reference at least one event.");
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function normalizeStringArray(
  values: readonly unknown[],
  fieldName: string,
): readonly string[] {
  return Object.freeze(
    values.map((value) => {
      if (typeof value !== "string") {
        throw new Error(`${fieldName} must contain only strings.`);
      }
      return requireNonBlank(value, fieldName);
    }),
  );
}

function requireOrgId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error("Incident orgId must contain 1 to 100 characters.");
  }
  return normalized;
}

function requireNonBlank(
  value: string | null | undefined,
  fieldName: string,
): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }
  return normalized;
}

function requireProbability(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1.`);
  }
  return value;
}

function requireDate(value: Date, fieldName: string): Date {
  const copy = new Date(value.getTime());
  if (!Number.isFinite(copy.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }
  return copy;
}
