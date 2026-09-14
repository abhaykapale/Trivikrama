import type {
  IActiveMatchRuleSource,
  RuleReloadReport,
} from "../domain/active-match-rule-source.contracts.js";
import type {
  DetectionEvent,
  IRuleEngine,
  RuleEngineStats,
  RuleEvaluationResult,
} from "../domain/rule-engine.contracts.js";
import { compileSigmaMatchRuleYaml } from "./compile-sigma-match-rule.js";
import { OrganizationRuleCache } from "./organization-rule-cache.js";
import { OrganizationRuleLoader } from "./organization-rule-loader.js";
import { StatelessSigmaRuleEngine } from "./stateless-sigma-rule-engine.js";

export interface ReloadableOrganizationSigmaRuleEngineDependencies {
  readonly organizationId: string;
  readonly source: IActiveMatchRuleSource;
  readonly now?: () => Date;
  readonly generateAlertId?: () => string;
  readonly monotonicNow?: () => number;
}

export class ReloadableOrganizationSigmaRuleEngine implements IRuleEngine {
  private readonly cache: OrganizationRuleCache;
  private readonly loader: OrganizationRuleLoader;
  private readonly evaluator: StatelessSigmaRuleEngine;
  private ready = false;
  private inFlightReload: Promise<void> | undefined;
  private lastReport: RuleReloadReport | undefined;

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

    return this.evaluator.evaluate(events);
  }

  public getStats(): RuleEngineStats {
    const rules = this.cache.getAll();

    return {
      totalRules: rules.length,
      activeRules: rules.length,
      disabledRules: 0,
      lastReloadAt:
        this.lastReport === undefined
          ? new Date(0)
          : new Date(this.lastReport.reloadedAt),
      rulesByType: { match: rules.length },
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

  private async performReload(): Promise<void> {
    const candidate = await this.loader.load(this.cache.getAll());
    this.cache.replace(candidate.rules);
    this.lastReport = candidate.report;
    this.ready = true;
  }
}
