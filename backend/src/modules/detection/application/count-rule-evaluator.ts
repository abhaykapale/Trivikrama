import { performance } from "node:perf_hooks";

import type { OrganizationCompiledCountRule } from "../domain/active-count-rule-source.contracts.js";
import type { ICountWindowStore } from "../domain/count-window-store.contracts.js";
import type { IAlertCooldownStore } from "../domain/alert-cooldown-store.contracts.js";
import type {
  DetectionEvent,
  RuleAlert,
  RuleEvaluationResult,
} from "../domain/rule-engine.contracts.js";
import { resolveOwnEventField } from "./event-field-accessor.js";
import { createDeterministicRuleAlertId } from "./rule-alert-id.js";

export interface CountRuleEvaluatorDependencies {
  readonly windowStore: ICountWindowStore;
  readonly selectRules: (
    event: DetectionEvent,
  ) => readonly OrganizationCompiledCountRule[];
  readonly now?: () => Date;
  readonly generateAlertId?: () => string;
  readonly monotonicNow?: () => number;
  readonly cooldownStore?: IAlertCooldownStore;
}

export class CountRuleEvaluator {
  private readonly now: () => Date;
  private readonly generateAlertId?: () => string;
  private readonly monotonicNow: () => number;

  public constructor(private readonly dependencies: CountRuleEvaluatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.generateAlertId = dependencies.generateAlertId;
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
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

      for (const rule of this.dependencies.selectRules(event)) {
        if (
          event.class_uid !== rule.logsource.classUid ||
          (rule.logsource.categoryUid !== undefined &&
            event.category_uid !== rule.logsource.categoryUid)
        ) {
          continue;
        }

        rulesEvaluated += 1;
        if (!rule.matches(event)) continue;

        const entityValue = resolveOwnEventField(
          event,
          rule.count.fieldSegments,
        );
        const entityKey = canonicalizeEntityKey(entityValue);
        if (entityKey === undefined) continue;

        matchedRuleIds.add(rule.id);
        const occurredAt = this.now();
        const snapshot = await this.dependencies.windowStore.recordMatch({
          organizationId: rule.organizationId,
          ruleId: rule.id,
          ruleStateVersion: rule.compiledHash,
          entityKey,
          eventId: event.event_id,
          occurredAtEpochMs: occurredAt.getTime(),
          windowSeconds: rule.count.timeWindowSeconds,
        });

        // An exact retry is allowed to reconstruct the same deterministic
        // alert while the window still represents the threshold crossing.
        if (snapshot.count !== rule.count.threshold) {
          continue;
        }

        const alertId =
          this.generateAlertId?.() ??
          createDeterministicRuleAlertId({
            organizationId: rule.organizationId,
            ruleId: rule.id,
            ruleStateVersion: rule.compiledHash,
            matchedEventIds: snapshot.eventIds,
          });

        if (
          rule.cooldownSeconds > 0 &&
          (this.dependencies.cooldownStore === undefined ||
            !(await this.dependencies.cooldownStore.tryAcquire({
              organizationId: rule.organizationId,
              ruleId: rule.id,
              ruleStateVersion: rule.compiledHash,
              entityKey,
              alertId,
              cooldownSeconds: rule.cooldownSeconds,
            })))
        ) {
          if (this.dependencies.cooldownStore === undefined) {
            throw new Error("A Redis cooldown store is required by this count rule.");
          }
          continue;
        }

        alerts.push({
          alertId,
          ruleId: rule.id,
          ruleName: rule.title,
          ruleDescription: rule.description,
          severity: rule.severity,
          weight: rule.weight,
          matchedEvents: snapshot.eventIds,
          matchedCondition: `${rule.condition}; count(${rule.count.field}) >= ${rule.count.threshold} within ${rule.count.timeWindowSeconds}s`,
          tags: rule.tags,
          timestamp: occurredAt,
          metadata: {
            ruleType: "count",
            sigmaId: rule.sigmaId,
            classUid: event.class_uid,
            categoryUid: event.category_uid,
            groupByField: rule.count.field,
            groupByValue: entityValue,
            count: snapshot.count,
            threshold: rule.count.threshold,
            timeWindowSeconds: rule.count.timeWindowSeconds,
            ruleStateVersion: rule.compiledHash,
          },
        });
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
}

function canonicalizeEntityKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.length === 0 || value.length > 1_024 ? undefined : `s:${value}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return undefined;
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
