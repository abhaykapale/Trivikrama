import { resolveOwnEventField } from "./event-field-accessor.js";
import { compileSupportedSigmaRuleYaml } from "./validate-sigma-rule.js";
import { RuleCommandNotFoundError } from "../domain/rule-command.contracts.js";
import type { IRuleQueryRepository } from "../domain/rule-query.contracts.js";
import {
  RULE_DRY_RUN_MAX_EVENTS,
  RULE_DRY_RUN_MAX_RANGE_SECONDS,
  RULE_DRY_RUN_SAMPLE_LIMIT,
  ruleOperationalSystemClock,
  type IRuleDryRunEventRepository,
  type RuleDryRunEvent,
  type RuleDryRunInput,
  type RuleDryRunResult,
  type RuleOperationalClock,
} from "../domain/rule-operational.contracts.js";

export interface DryRunRuleUseCaseDependencies {
  readonly rules: Pick<IRuleQueryRepository, "findById">;
  readonly events: IRuleDryRunEventRepository;
  readonly clock?: RuleOperationalClock;
}

export class DryRunRuleUseCase {
  private readonly clock: RuleOperationalClock;

  public constructor(private readonly dependencies: DryRunRuleUseCaseDependencies) {
    this.clock = dependencies.clock ?? ruleOperationalSystemClock;
  }

  public async execute(input: RuleDryRunInput): Promise<RuleDryRunResult> {
    validateInput(input);
    const rule = await this.dependencies.rules.findById({
      orgId: input.orgId,
      ruleId: input.ruleId,
    });
    if (rule === null) throw new RuleCommandNotFoundError(input.ruleId);

    const compiled = compileSupportedSigmaRuleYaml(rule.yamlContent);
    const to = this.clock.now();
    const from = new Date(to.getTime() - input.timeRangeSeconds * 1_000);
    const events = await this.dependencies.events.listForRule({
      orgId: input.orgId,
      classUid: compiled.logsource.classUid,
      ...(compiled.logsource.categoryUid === undefined
        ? {}
        : { categoryUid: compiled.logsource.categoryUid }),
      from,
      to,
      limit: input.limit,
    });

    const startedAt = this.clock.monotonicNow();
    const evaluation = compiled.type === "match"
      ? evaluateMatch(compiled, events)
      : evaluateCount(compiled, events);
    const executionTimeMs = Math.max(0, this.clock.monotonicNow() - startedAt);

    return {
      ruleId: rule.id,
      sigmaId: compiled.sigmaId,
      ruleName: compiled.title,
      totalEvaluated: events.length,
      matches: evaluation.matches,
      matchedEventIds: evaluation.matchedEventIds,
      executionTimeMs,
      sampleMatches: evaluation.samples,
    };
  }
}

type CompiledRule = ReturnType<typeof compileSupportedSigmaRuleYaml>;
type CompiledMatch = Extract<CompiledRule, { readonly type: "match" }>;
type CompiledCount = Extract<CompiledRule, { readonly type: "count" }>;

interface EvaluationSummary {
  readonly matches: number;
  readonly matchedEventIds: readonly string[];
  readonly samples: RuleDryRunResult["sampleMatches"];
}

function evaluateMatch(
  rule: CompiledMatch,
  events: readonly RuleDryRunEvent[],
): EvaluationSummary {
  const matched: RuleDryRunEvent[] = [];
  for (const candidate of events) {
    if (rule.matches(candidate.event)) matched.push(candidate);
  }
  return {
    matches: matched.length,
    matchedEventIds: matched.map((item) => item.event.event_id),
    samples: matched.slice(0, RULE_DRY_RUN_SAMPLE_LIMIT).map((item) => ({
      eventId: item.event.event_id,
      time: item.time,
      message: item.message,
      matchedCondition: rule.condition,
    })),
  };
}

function evaluateCount(
  rule: CompiledCount,
  events: readonly RuleDryRunEvent[],
): EvaluationSummary {
  const windows = new Map<string, RuleDryRunEvent[]>();
  const matchedEventIds = new Set<string>();
  const samples: RuleDryRunResult["sampleMatches"][number][] = [];
  let matches = 0;

  for (const candidate of events) {
    if (!rule.matches(candidate.event)) continue;
    const entity = canonicalizeEntity(
      resolveOwnEventField(candidate.event, rule.count.fieldSegments),
    );
    if (entity === null) continue;

    const cutoff = candidate.time.getTime() - rule.count.timeWindowSeconds * 1_000;
    const current = (windows.get(entity) ?? []).filter(
      (item) => item.time.getTime() > cutoff,
    );
    current.push(candidate);
    windows.set(entity, current);

    if (current.length !== rule.count.threshold) continue;
    matches += 1;
    for (const item of current) matchedEventIds.add(item.event.event_id);
    if (samples.length < RULE_DRY_RUN_SAMPLE_LIMIT) {
      samples.push({
        eventId: candidate.event.event_id,
        time: candidate.time,
        message: candidate.message,
        matchedCondition: `${rule.condition}; count(${rule.count.field}) >= ${rule.count.threshold} within ${rule.count.timeWindowSeconds}s`,
      });
    }
  }

  return { matches, matchedEventIds: [...matchedEventIds], samples };
}

function canonicalizeEntity(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= 1_024) {
    return `s:${value}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return null;
}

function validateInput(input: RuleDryRunInput): void {
  if (
    !Number.isSafeInteger(input.timeRangeSeconds) ||
    input.timeRangeSeconds < 60 ||
    input.timeRangeSeconds > RULE_DRY_RUN_MAX_RANGE_SECONDS
  ) {
    throw new Error("timeRangeSeconds is outside the supported range");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > RULE_DRY_RUN_MAX_EVENTS) {
    throw new Error(`limit must be an integer between 1 and ${RULE_DRY_RUN_MAX_EVENTS}`);
  }
}
