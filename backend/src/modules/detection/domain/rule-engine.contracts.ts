export type RuleSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export interface DetectionEvent {
  readonly event_id: string;
  readonly class_uid: number;
  readonly category_uid: number;
  readonly [field: string]: unknown;
}

export interface RuleLogsource {
  readonly classUid: number;
  readonly categoryUid?: number;
}

export interface CompiledSigmaMatchRule {
  readonly id: string;
  readonly sigmaId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly priority: number;
  readonly logsource: RuleLogsource;
  readonly tags: readonly string[];
  readonly condition: string;
  readonly compiledHash: string;
  readonly matches: (event: DetectionEvent) => boolean;
}

export interface RuleAlert {
  readonly alertId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleDescription: string;
  readonly severity: RuleSeverity;
  readonly weight: number;
  readonly matchedEvents: readonly string[];
  readonly matchedCondition: string;
  readonly tags: readonly string[];
  readonly timestamp: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RuleEvaluationStats {
  readonly rulesEvaluated: number;
  readonly rulesMatched: number;
  readonly alertsGenerated: number;
  readonly evaluationDurationMs: number;
  readonly eventsEvaluated: number;
}

export interface RuleEvaluationResult {
  readonly alerts: readonly RuleAlert[];
  readonly stats: RuleEvaluationStats;
}

export interface RuleEngineStats {
  readonly totalRules: number;
  readonly activeRules: number;
  readonly disabledRules: number;
  readonly lastReloadAt: Date;
  readonly rulesByType: Readonly<Record<"match", number>>;
}

export interface IRuleEngine {
  evaluate(events: readonly DetectionEvent[]): Promise<RuleEvaluationResult>;
  reloadRules(): Promise<void>;
  getStats(): RuleEngineStats;
}
