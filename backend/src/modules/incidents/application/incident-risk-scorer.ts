import { normalizeIncidentEntity } from "../domain/incident-entity.js";
import type {
  AssetCriticalityResolver,
  IncidentRiskFactorBreakdown,
  IncidentRiskScoreInput,
  IncidentRiskScoreResult,
  IncidentRiskScoringConfiguration,
} from "../domain/incident-risk.contracts.js";
import type { IncidentSeverity } from "../domain/incident.contracts.js";
import type { UnifiedAiAlert } from "../domain/unified-alert.contracts.js";

const WEIGHT_TOLERANCE = 1e-9;

export const DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION: IncidentRiskScoringConfiguration =
  Object.freeze({
    weights: Object.freeze({
      rule: 0.3,
      ml: 0.25,
      asset: 0.2,
      density: 0.15,
      killChain: 0.1,
    }),
    densityThreshold: 20,
    neutralDefault: 0.5,
    killChainEnabled: false,
    severityThresholds: Object.freeze({
      critical: 80,
      high: 60,
      medium: 40,
      low: 20,
    }),
  });

export class IncidentRiskScorer {
  private readonly configuration: IncidentRiskScoringConfiguration;

  public constructor(
    private readonly assetCriticalityResolver: AssetCriticalityResolver,
    configuration: IncidentRiskScoringConfiguration =
      DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION,
  ) {
    this.configuration = validateConfiguration(configuration);
  }

  public async score(
    input: IncidentRiskScoreInput,
  ): Promise<IncidentRiskScoreResult> {
    const orgId = requireOrgId(input.orgId);
    validateAlerts(orgId, input.alerts);

    const ruleAlert = maxBy(
      input.alerts.filter((alert) => alert.type === "rule"),
      (alert) => alert.weight,
    );
    const aiAlert = maxBy(
      input.alerts.filter(
        (alert): alert is UnifiedAiAlert =>
          alert.type === "ai" && alert.metadata.usedFallback !== true,
      ),
      (alert) => alert.anomalyScore,
    );

    const ruleValue = ruleAlert?.weight ?? this.configuration.neutralDefault;
    const mlValue =
      aiAlert?.type === "ai"
        ? aiAlert.anomalyScore
        : this.configuration.neutralDefault;
    const assetValue = await this.resolveAssetCriticality(
      orgId,
      input.primaryEntity,
    );
    const densityValue = Math.min(
      1,
      input.alerts.length / this.configuration.densityThreshold,
    );
    const distinctStages = new Set(input.killChainStages).size;
    const killChainValue = this.configuration.killChainEnabled
      ? Math.min(1, distinctStages / 3)
      : 0;

    const factors = Object.freeze({
      ruleWeight: factor(
        ruleValue,
        this.configuration.weights.rule,
        ruleAlert === undefined ? "neutral_default" : "observed",
        ruleAlert === undefined
          ? "No rule alert available"
          : `Rule ${ruleAlert.ruleId}`,
      ),
      mlConfidence: factor(
        mlValue,
        this.configuration.weights.ml,
        aiAlert === undefined ? "neutral_default" : "observed",
        aiAlert === undefined
          ? "No trustworthy AI anomaly available"
          : `AI ${aiAlert.modelName}@${aiAlert.modelVersion}`,
      ),
      assetCriticality: factor(
        assetValue.value,
        this.configuration.weights.asset,
        assetValue.observed ? "observed" : "neutral_default",
        assetValue.observed
          ? `Asset ${assetValue.entityValue}`
          : "Asset criticality unavailable",
      ),
      alertDensity: factor(
        densityValue,
        this.configuration.weights.density,
        "observed",
        `${input.alerts.length} alerts / ${this.configuration.densityThreshold} threshold`,
      ),
      killChainBonus: factor(
        killChainValue,
        this.configuration.weights.killChain,
        this.configuration.killChainEnabled ? "observed" : "disabled",
        this.configuration.killChainEnabled
          ? `${distinctStages} distinct kill-chain stages`
          : "Kill-chain scoring disabled",
      ),
    });

    const rawScore = clamp(
      Object.values(factors).reduce(
        (sum, item) => sum + item.contribution,
        0,
      ),
      0,
      1,
    );
    const riskScore = round(rawScore * 100, 2);

    return Object.freeze({
      incidentId: normalizeOptionalId(input.incidentId),
      riskScore,
      severity: classifyIncidentRiskSeverity(
        riskScore,
        this.configuration.severityThresholds,
      ),
      scoreBreakdown: Object.freeze({
        factors,
        rawScore: round(rawScore, 6),
        finalScore: riskScore,
        formula: buildFormula(factors, riskScore),
      }),
    });
  }

  public async scoreBatch(
    inputs: readonly IncidentRiskScoreInput[],
  ): Promise<readonly IncidentRiskScoreResult[]> {
    const results: IncidentRiskScoreResult[] = [];
    for (const input of inputs) {
      results.push(await this.score(input));
    }
    return Object.freeze(results);
  }

  private async resolveAssetCriticality(
    orgId: string,
    primaryEntity: IncidentRiskScoreInput["primaryEntity"],
  ): Promise<{ readonly value: number; readonly observed: boolean; readonly entityValue: string }> {
    if (primaryEntity === null) {
      return {
        value: this.configuration.neutralDefault,
        observed: false,
        entityValue: "",
      };
    }

    const entity = normalizeIncidentEntity(primaryEntity);
    const resolved = await this.assetCriticalityResolver.resolve({ orgId, entity });
    if (resolved === null) {
      return {
        value: this.configuration.neutralDefault,
        observed: false,
        entityValue: entity.value,
      };
    }
    requireProbability(resolved, "asset criticality");
    return { value: resolved, observed: true, entityValue: entity.value };
  }
}

export function classifyIncidentRiskSeverity(
  score: number,
  thresholds = DEFAULT_INCIDENT_RISK_SCORING_CONFIGURATION.severityThresholds,
): IncidentSeverity {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("risk score must be between 0 and 100.");
  }
  validateThresholds(thresholds);
  if (score >= thresholds.critical) return "critical";
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  if (score >= thresholds.low) return "low";
  return "informational";
}

function factor(
  value: number,
  weight: number,
  availability: IncidentRiskFactorBreakdown["availability"],
  source: string,
): IncidentRiskFactorBreakdown {
  requireProbability(value, "risk factor");
  return Object.freeze({
    value,
    weight,
    contribution: round(value * weight, 6),
    availability,
    source,
  });
}

function validateAlerts(
  orgId: string,
  alerts: IncidentRiskScoreInput["alerts"],
): void {
  const ids = new Set<string>();
  for (const alert of alerts) {
    if (alert.orgId !== orgId) {
      throw new Error(`Unified alert ${alert.id} crossed the incident organization boundary.`);
    }
    if (ids.has(alert.id)) {
      throw new Error(`Duplicate unified alert identity: ${alert.id}.`);
    }
    ids.add(alert.id);
  }
}

function maxBy<T>(values: readonly T[], select: (value: T) => number): T | undefined {
  let selected: T | undefined;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const candidate = select(value);
    requireProbability(candidate, "alert score");
    if (candidate > maximum) {
      maximum = candidate;
      selected = value;
    }
  }
  return selected;
}

function validateConfiguration(
  input: IncidentRiskScoringConfiguration,
): IncidentRiskScoringConfiguration {
  const weights = Object.values(input.weights);
  for (const weight of weights) requireProbability(weight, "risk weight");
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
    throw new Error("Incident risk weights must sum to 1.0.");
  }
  if (!Number.isInteger(input.densityThreshold) || input.densityThreshold < 1) {
    throw new Error("densityThreshold must be a positive integer.");
  }
  requireProbability(input.neutralDefault, "neutralDefault");
  validateThresholds(input.severityThresholds);
  return Object.freeze({
    ...input,
    weights: Object.freeze({ ...input.weights }),
    severityThresholds: Object.freeze({ ...input.severityThresholds }),
  });
}

function validateThresholds(
  thresholds: IncidentRiskScoringConfiguration["severityThresholds"],
): void {
  const { critical, high, medium, low } = thresholds;
  if (
    ![critical, high, medium, low].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    ) ||
    !(critical > high && high > medium && medium > low)
  ) {
    throw new Error("Severity thresholds must be descending values between 0 and 100.");
  }
}

function buildFormula(
  factors: Record<string, IncidentRiskFactorBreakdown>,
  riskScore: number,
): string {
  return `100 × (${Object.values(factors)
    .map((item) => `${item.weight}×${item.value}`)
    .join(" + ")}) = ${riskScore}`;
}

function requireProbability(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1.`);
  }
}

function requireOrgId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error("Incident orgId must contain 1 to 100 characters.");
  }
  return normalized;
}

function normalizeOptionalId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("incidentId must not be blank.");
  return normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
