import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type { DetectionEvent, IRuleEngine, RuleEvaluationStats } from "../domain/rule-engine.contracts.js";
import type { PersistRuleAlertsService } from "./persist-rule-alerts.service.js";
import type { AlertRecord } from "../../../database/repositories/alerts/alert.repository.js";

export interface EvaluateAndPersistRuleAlertsDependencies {
  readonly organizationId: string;
  readonly ruleEngine: Pick<IRuleEngine, "evaluate">;
  readonly alertPersistence: Pick<PersistRuleAlertsService, "execute">;
}

export interface EvaluateAndPersistRuleAlertsResult {
  readonly evaluation: RuleEvaluationStats;
  readonly insertedAlerts: number;
  readonly alreadyPresentAlerts: number;
  readonly records?: readonly AlertRecord[];
}

/**
 * Application boundary joining normalized ingestion to deterministic rule
 * evaluation and idempotent PostgreSQL alert persistence.
 */
export class EvaluateAndPersistRuleAlertsService {
  private readonly organizationId: string;

  public constructor(
    private readonly dependencies: EvaluateAndPersistRuleAlertsDependencies,
  ) {
    this.organizationId = requireOrganizationId(dependencies.organizationId);
  }

  public async execute(
    events: readonly CreateNormalizedEventInput[],
  ): Promise<EvaluateAndPersistRuleAlertsResult> {
    this.assertTrustedOrganizationBoundary(events);

    const detectionEvents: DetectionEvent[] = events.map((event) => ({ ...event }));
    const evaluation = await this.dependencies.ruleEngine.evaluate(detectionEvents);
    const persistence = await this.dependencies.alertPersistence.execute(
      this.organizationId,
      evaluation.alerts,
    );

    return {
      evaluation: evaluation.stats,
      insertedAlerts: persistence.insertedCount,
      alreadyPresentAlerts: persistence.alreadyPresentCount,
      records: persistence.records,
    };
  }

  private assertTrustedOrganizationBoundary(
    events: readonly CreateNormalizedEventInput[],
  ): void {
    const crossing = events.find(
      (event) => event.org_id !== this.organizationId,
    );

    if (crossing !== undefined) {
      throw new Error(
        `Normalized event ${crossing.event_id} crossed the configured organization boundary.`,
      );
    }
  }
}

function requireOrganizationId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error("Detection organizationId must contain 1 to 100 characters.");
  }
  return normalized;
}
