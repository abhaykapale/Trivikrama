import type {
  IncidentEntity,
  IncidentSeverity,
} from "./incident.contracts.js";

interface UnifiedAlertBase {
  readonly id: string;
  readonly orgId: string;
  readonly severity: IncidentSeverity;
  readonly weight: number;
  readonly tags: readonly string[];
  readonly matchedEventIds: readonly string[];
  readonly timestamp: Date;
  readonly entities: readonly IncidentEntity[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface UnifiedRuleAlert extends UnifiedAlertBase {
  readonly type: "rule";
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matchedCondition: string;
}

export interface UnifiedAiAlert extends UnifiedAlertBase {
  readonly type: "ai";
  readonly modelName: string;
  readonly modelVersion: string;
  readonly anomalyScore: number;
  readonly confidence: number | null;
}

export type UnifiedAlert = UnifiedRuleAlert | UnifiedAiAlert;

/** Structural boundary accepted from PostgreSQL rule-alert persistence. */
export interface RuleAlertSource {
  readonly id: string;
  readonly alertType: "rule" | "ai";
  readonly ruleId: string | null;
  readonly ruleName: string | null;
  readonly matchedCondition: string | null;
  readonly severity: IncidentSeverity;
  readonly weight: number;
  readonly tags: readonly unknown[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly matchedEventIds: readonly unknown[];
  readonly createdAt: Date;
  readonly orgId: string;
}

/** Structural boundary accepted from MongoDB AI-result persistence. */
export interface AiResultSource {
  readonly event_id: string;
  readonly batch_id?: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly anomaly_score: number;
  readonly is_anomaly: boolean;
  readonly confidence?: number;
  readonly threat_category?: string;
  readonly threat_confidence?: number;
  readonly shap_explanation?: unknown;
  readonly input_features?: Readonly<Record<string, unknown>>;
  readonly processing_time_ms?: number;
  readonly used_fallback?: boolean;
  readonly created_at: Date;
  readonly org_id?: string;
}

export interface MergeAlertSourcesInput {
  readonly orgId: string;
  readonly ruleAlerts: readonly RuleAlertSource[];
  readonly aiResults: readonly AiResultSource[];
}

export interface MergeAlertSourcesResult {
  readonly alerts: readonly UnifiedAlert[];
  readonly ruleAlertsMerged: number;
  readonly aiAlertsMerged: number;
  readonly nonAnomalousAiResultsIgnored: number;
}

export interface DeduplicateUnifiedAlertsResult {
  readonly alerts: readonly UnifiedAlert[];
  readonly inputCount: number;
  readonly duplicatesRemoved: number;
}
