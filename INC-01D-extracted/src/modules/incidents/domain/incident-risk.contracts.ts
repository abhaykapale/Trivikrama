import type {
  IncidentEntity,
  IncidentKillChainStage,
  IncidentSeverity,
} from "./incident.contracts.js";
import type { UnifiedAlert } from "./unified-alert.contracts.js";

export interface IncidentRiskWeights {
  readonly rule: number;
  readonly ml: number;
  readonly asset: number;
  readonly density: number;
  readonly killChain: number;
}

export interface IncidentSeverityThresholds {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface IncidentRiskScoringConfiguration {
  readonly weights: IncidentRiskWeights;
  readonly densityThreshold: number;
  readonly neutralDefault: number;
  readonly killChainEnabled: boolean;
  readonly severityThresholds: IncidentSeverityThresholds;
}

export interface IncidentRiskScoreInput {
  readonly incidentId?: string;
  readonly orgId: string;
  readonly alerts: readonly UnifiedAlert[];
  readonly primaryEntity: IncidentEntity | null;
  readonly killChainStages: readonly IncidentKillChainStage[];
}

export type RiskFactorAvailability = "observed" | "neutral_default" | "disabled";

export interface IncidentRiskFactorBreakdown {
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  readonly availability: RiskFactorAvailability;
  readonly source: string;
}

export interface IncidentRiskScoreBreakdown {
  readonly factors: {
    readonly ruleWeight: IncidentRiskFactorBreakdown;
    readonly mlConfidence: IncidentRiskFactorBreakdown;
    readonly assetCriticality: IncidentRiskFactorBreakdown;
    readonly alertDensity: IncidentRiskFactorBreakdown;
    readonly killChainBonus: IncidentRiskFactorBreakdown;
  };
  readonly rawScore: number;
  readonly finalScore: number;
  readonly formula: string;
}

export interface IncidentRiskScoreResult {
  readonly incidentId: string | null;
  readonly riskScore: number;
  readonly severity: IncidentSeverity;
  readonly scoreBreakdown: IncidentRiskScoreBreakdown;
}

export interface AssetCriticalityResolver {
  resolve(input: {
    readonly orgId: string;
    readonly entity: IncidentEntity;
  }): Promise<number | null>;
}
