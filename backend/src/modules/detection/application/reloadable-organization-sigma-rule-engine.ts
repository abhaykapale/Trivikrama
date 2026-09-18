import type {
  IActiveMatchRuleSource,
  RuleReloadReport,
} from "../domain/active-match-rule-source.contracts.js";
import type {
  IActiveCountRuleSource,
  OrganizationCompiledCountRule,
} from "../domain/active-count-rule-source.contracts.js";
import type { ICountWindowStore } from "../domain/count-window-store.contracts.js";
import type {
  DetectionEvent,
  IRuleEngine,
  RuleEngineStats,
  RuleEvaluationResult,
} from "../domain/rule-engine.contracts.js";
import { compileSigmaMatchRuleYaml } from "./compile-sigma-match-rule.js";
import { compileSigmaCountRuleYaml } from "./compile-sigma-count-rule.js";
import { CountRuleEvaluator } from "./count-rule-evaluator.js";
import { OrganizationCountRuleLoader } from "./organization-count-rule-loader.js";
import { OrganizationRuleCache } from "./organization-rule-cache.js";
import { OrganizationRuleLoader } from "./organization-rule-loader.js";
import { StatelessSigmaRuleEngine } from "./stateless-sigma-rule-engine.js";

export interface ReloadableOrganizationSigmaRuleEngineDependencies {
  readonly organizationId: string;
  readonly source: IActiveMatchRuleSource;
  readonly countSource?: IActiveCountRuleSource;
  readonly countWindowStore?: ICountWindowStore;
  readonly now?: () => Date;
  readonly generateAlertId?: () => string;
  readonly monotonicNow?: () => number;
}

export class ReloadableOrganizationSigmaRuleEngine implements IRuleEngine {
  private readonly cache: OrganizationRuleCache;
  private readonly loader: OrganizationRuleLoader;
  private readonly evaluator: StatelessSigmaRuleEngine;
  private readonly countCache?: OrganizationRuleCache<OrganizationCompiledCountRule>;
  private readonly countLoader?: OrganizationCountRuleLoader;
  private readonly countEvaluator?: CountRuleEvaluator;
  private ready = false;
  private inFlightReload: Promise<void> | undefined;
  private lastReport: RuleReloadReport | undefined;
  private lastCountReport: RuleReloadReport | undefined;

  public constructor(
    dependencies: ReloadableOrganizationSigmaRuleEngineDependencies,
  ) {
    this.cache = new OrganizationRuleCache(dependencies.organizationId);
    this.loader = new OrganizationRuleLoader({
      organizationId: dependencies.organizationId,
      source: dependencies.source,
      compile: compileSigmaMatchRuleYaml,
      now: dependencies.now,
    });
    this.evaluator = new StatelessSigmaRuleEngine([], {
      now: dependencies.now,
      generateAlertId: dependencies.generateAlertId,
      monotonicNow: dependencies.monotonicNow,
      selectRules: (event) => this.cache.getByClass(event.class_uid),
    });

    if (
      (dependencies.countSource === undefined) !==
      (dependencies.countWindowStore === undefined)
    ) {
      throw new Error("Count-rule source and window store must be configured together.");
    }

    if (
      dependencies.countSource !== undefined &&
      dependencies.countWindowStore !== undefined
    ) {
      this.countCache = new OrganizationRuleCache<OrganizationCompiledCountRule>(
        dependencies.organizationId,
      );
      this.countLoader = new OrganizationCountRuleLoader({
        organizationId: dependencies.organizationId,
        source: dependencies.countSource,
        compile: compileSigmaCountRuleYaml,
        now: dependencies.now,
      });
      this.countEvaluator = new CountRuleEvaluator({
        windowStore: dependencies.countWindowStore,
        selectRules: (event) => this.countCache?.getByClass(event.class_uid) ?? [],
        now: dependencies.now,
        generateAlertId: dependencies.generateAlertId,
        monotonicNow: dependencies.monotonicNow,
      });
    }
  }

  public async reloadRules(): Promise<void> {
    if (this.inFlightReload !== undefined) {
      return this.inFlightReload;
    }

    const reload = this.performReload();
    this.inFlightReload = reload;

    try {
      await reload;
    } finally {
      if (this.inFlightReload === reload) {
        this.inFlightReload = undefined;
      }
    }
  }

  public async evaluate(
    events: readonly DetectionEvent[],
  ): Promise<RuleEvaluationResult> {
    if (!this.ready) {
      throw new Error("Rule Engine must complete an initial reload before evaluation.");
    }

    const matchResult = await this.evaluator.evaluate(events);
    if (this.countEvaluator === undefined) return matchResult;

    const countResult = await this.countEvaluator.evaluate(events);
    return {
      alerts: Object.freeze([...matchResult.alerts, ...countResult.alerts]),
      stats: {
        rulesEvaluated:
          matchResult.stats.rulesEvaluated + countResult.stats.rulesEvaluated,
        rulesMatched:
          matchResult.stats.rulesMatched + countResult.stats.rulesMatched,
        alertsGenerated:
          matchResult.stats.alertsGenerated + countResult.stats.alertsGenerated,
        evaluationDurationMs:
          matchResult.stats.evaluationDurationMs +
          countResult.stats.evaluationDurationMs,
        eventsEvaluated: events.length,
      },
    };
  }

  public getStats(): RuleEngineStats {
    const rules = this.cache.getAll();
    const countRules = this.countCache?.getAll() ?? [];

    return {
      totalRules: rules.length + countRules.length,
      activeRules: rules.length + countRules.length,
      disabledRules: 0,
      lastReloadAt:
        this.lastReport === undefined
          ? new Date(0)
          : new Date(this.lastReport.reloadedAt),
      rulesByType: { match: rules.length, count: countRules.length },
    };
  }

  public getLastReloadReport(): RuleReloadReport | undefined {
    return this.lastReport === undefined
      ? undefined
      : {
          ...this.lastReport,
          reloadedAt: new Date(this.lastReport.reloadedAt),
        };
  }

  public getLastCountReloadReport(): RuleReloadReport | undefined {
    return this.lastCountReport === undefined
      ? undefined
      : {
          ...this.lastCountReport,
          reloadedAt: new Date(this.lastCountReport.reloadedAt),
        };
  }

  private async performReload(): Promise<void> {
    const matchCandidatePromise = this.loader.load(this.cache.getAll());
    const countCandidatePromise =
      this.countLoader === undefined || this.countCache === undefined
        ? undefined
        : this.countLoader.load(this.countCache.getAll());
    const [matchCandidate, countCandidate] = await Promise.all([
      matchCandidatePromise,
      countCandidatePromise,
    ]);

    // Publish only after every configured source produced a complete candidate.
    this.cache.replace(matchCandidate.rules);
    if (countCandidate !== undefined && this.countCache !== undefined) {
      this.countCache.replace(countCandidate.rules);
    }
    this.lastReport = matchCandidate.report;
    this.lastCountReport = countCandidate?.report;
    this.ready = true;
  }
}
