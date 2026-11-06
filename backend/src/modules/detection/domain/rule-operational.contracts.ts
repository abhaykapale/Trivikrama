import type { RuleStatus } from "../../../database/repositories/rules/rule.repository.js";
import type { DetectionEvent } from "./rule-engine.contracts.js";

export const RULE_DRY_RUN_MAX_EVENTS = 1_000;
export const RULE_DRY_RUN_MAX_RANGE_SECONDS = 30 * 24 * 60 * 60;
export const RULE_DRY_RUN_SAMPLE_LIMIT = 10;
export const RULE_EXPORT_MAX_RULES = 10_000;

export interface RuleDryRunInput {
  readonly orgId: string;
  readonly ruleId: string;
  readonly timeRangeSeconds: number;
  readonly limit: number;
}

export interface RuleDryRunEvent {
  readonly event: DetectionEvent;
  readonly time: Date;
  readonly message: string;
}

export interface RuleDryRunEventQuery {
  readonly orgId: string;
  readonly classUid: number;
  readonly categoryUid?: number;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
}

export interface IRuleDryRunEventRepository {
  listForRule(input: RuleDryRunEventQuery): Promise<readonly RuleDryRunEvent[]>;
}

export interface RuleDryRunSample {
  readonly eventId: string;
  readonly time: Date;
  readonly message: string;
  readonly matchedCondition: string;
}

export interface RuleDryRunResult {
  readonly ruleId: string;
  readonly sigmaId: string;
  readonly ruleName: string;
  readonly totalEvaluated: number;
  readonly matches: number;
  readonly matchedEventIds: readonly string[];
  readonly executionTimeMs: number;
  readonly sampleMatches: readonly RuleDryRunSample[];
}

export interface ExportRulesInput {
  readonly orgId: string;
  readonly status: RuleStatus;
}

export interface ExportRulesResult {
  readonly content: string;
  readonly filename: string;
  readonly count: number;
}

export interface RuleOperationalClock {
  now(): Date;
  monotonicNow(): number;
}

export const ruleOperationalSystemClock: RuleOperationalClock = {
  now: () => new Date(),
  monotonicNow: () => performance.now(),
};

export class RuleExportLimitExceededError extends Error {
  public readonly code = "RULE_EXPORT_LIMIT_EXCEEDED" as const;

  public constructor(public readonly total: number) {
    super(`Rule export contains ${total} rows; the maximum is ${RULE_EXPORT_MAX_RULES}.`);
    this.name = "RuleExportLimitExceededError";
  }
}
