import type { FeatureEnrichedEvent } from "../../feature-extraction/domain/feature-extraction.contracts.js";

export type AiCircuitState = "closed" | "open" | "half-open";

export interface AiShapFeatureContribution {
    readonly name: string;
    readonly value: number;
    readonly shapValue: number;
}

export interface AiShapExplanation {
    readonly baseValue: number;
    readonly features: readonly AiShapFeatureContribution[];
}

export interface AiDetectionPrediction {
    readonly eventId: string;
    readonly anomalyScore: number;
    readonly isAnomaly: boolean;
    readonly confidence: number;
    readonly shapExplanation: AiShapExplanation | null;
    readonly modelVersion: string;
    readonly processingTimeMs: number;
}

export interface AiDetectionStats {
    readonly eventsSubmitted: number;
    readonly eventsScored: number;
    readonly anomaliesDetected: number;
    readonly batchesSubmitted: number;
    readonly requestDurationMs: number;
    readonly usedFallback: boolean;
}

export interface AiDetectionResult {
    readonly predictions: readonly AiDetectionPrediction[];
    readonly stats: AiDetectionStats;
}

export interface AiClientStats {
    readonly totalRequests: number;
    readonly successfulRequests: number;
    readonly failedRequests: number;
    readonly fallbacksUsed: number;
    readonly averageLatencyMs: number;
    readonly circuitState: AiCircuitState;
}

export interface IAIClient {
    detect(events: readonly FeatureEnrichedEvent[]): Promise<AiDetectionResult>;
    getStats(): AiClientStats;
}
