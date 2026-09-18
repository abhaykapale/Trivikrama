import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import type {
  CompiledSigmaMatchRule,
  DetectionEvent,
  RuleAlert,
  RuleEngineStats,
  RuleEvaluationResult,
} from "../domain/rule-engine.contracts.js";

export interface StatelessSigmaRuleEngineDependencies {
  readonly now?: () => Date;
  readonly generateAlertId?: () => string;
  readonly monotonicNow?: () => number;
  readonly selectRules?: (
    event: DetectionEvent,
  ) => readonly CompiledSigmaMatchRule[];
}

/**
 * Pure match evaluator used by BE-DET-01A.
 *
 * BE-DET-01B will compose it with a PostgreSQL rule loader and implement the
 * complete IRuleEngine reload lifecycle.
 */
export class StatelessSigmaRuleEngine {
  private rules: readonly CompiledSigmaMatchRule[] = [];
  private lastReloadAt: Date;
  private readonly now: () => Date;
  private readonly generateAlertId: () => string;
  private readonly monotonicNow: () => number;
  private readonly selectRules?: (
    event: DetectionEvent,
  ) => readonly CompiledSigmaMatchRule[];

  public constructor(
    rules: readonly CompiledSigmaMatchRule[],
    dependencies: StatelessSigmaRuleEngineDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.generateAlertId = dependencies.generateAlertId ?? randomUUID;
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.selectRules = dependencies.selectRules;
    this.lastReloadAt = this.now();
    this.replaceRules(rules);
  }

  public replaceRules(rules: readonly CompiledSigmaMatchRule[]): void {
    this.rules = Object.freeze(
      [...rules].sort((left, right) => right.priority - left.priority),
    );
    this.lastReloadAt = this.now();
  }

  public async evaluate(
    events: readonly DetectionEvent[],
  ): Promise<RuleEvaluationResult> {
    const startedAt = this.monotonicNow();
    const alerts: RuleAlert[] = [];
    const matchedRuleIds = new Set<string>();
    let rulesEvaluated = 0;

    for (const event of events) {
      validateEvent(event);

      const candidateRules = this.selectRules?.(event) ?? this.rules;

      for (const rule of candidateRules) {
        if (
          event.class_uid !== rule.logsource.classUid ||
          (rule.logsource.categoryUid !== undefined &&
            event.category_uid !== rule.logsource.categoryUid)
        ) {
          continue;
        }

        rulesEvaluated += 1;

        if (!rule.matches(event)) {
          continue;
        }

        matchedRuleIds.add(rule.id);
        alerts.push(this.buildAlert(rule, event));
      }
    }

    return {
      alerts,
      stats: {
        rulesEvaluated,
        rulesMatched: matchedRuleIds.size,
        alertsGenerated: alerts.length,
        evaluationDurationMs: Math.max(0, this.monotonicNow() - startedAt),
        eventsEvaluated: events.length,
      },
    };
  }

  public getStats(): RuleEngineStats {
    return {
      totalRules: this.rules.length,
      activeRules: this.rules.length,
      disabledRules: 0,
      lastReloadAt: new Date(this.lastReloadAt),
      rulesByType: { match: this.rules.length, count: 0 },
    };
  }

  private buildAlert(
    rule: CompiledSigmaMatchRule,
    event: DetectionEvent,
  ): RuleAlert {
    return {
      alertId: this.generateAlertId(),
      ruleId: rule.id,
      ruleName: rule.title,
      ruleDescription: rule.description,
      severity: rule.severity,
      weight: rule.weight,
      matchedEvents: [event.event_id],
      matchedCondition: rule.condition,
      tags: rule.tags,
      timestamp: this.now(),
      metadata: {
        ruleType: "match",
        sigmaId: rule.sigmaId,
        classUid: event.class_uid,
        categoryUid: event.category_uid,
      },
    };
  }
}

function validateEvent(event: DetectionEvent): void {
  if (
    typeof event.event_id !== "string" ||
    event.event_id.trim().length === 0 ||
    !Number.isSafeInteger(event.class_uid) ||
    event.class_uid < 0 ||
    !Number.isSafeInteger(event.category_uid) ||
    event.category_uid < 0
  ) {
    throw new Error("Detection event must contain a non-blank event_id and non-negative class/category UIDs.");
  }
}
