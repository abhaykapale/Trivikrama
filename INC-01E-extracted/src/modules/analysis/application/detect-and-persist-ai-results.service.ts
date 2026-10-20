import type {
    CreateAiResultInput,
    IAiResultRepository,
} from "../../../database/repositories/mongodb/ai-result.repository.js";
import {
    selectAiFeatureVector,
    type FeatureEnrichedEvent,
} from "../../feature-extraction/index.js";
import type { IAIClient } from "../domain/ai-client.contracts.js";

const MODEL_NAME = "isolation_forest_v1";

export interface DetectAndPersistAiResultsDependencies {
    readonly organizationId: string;
    readonly client: Pick<IAIClient, "detect">;
    readonly results: Pick<IAiResultRepository, "createManyIfAbsent">;
    readonly now: () => Date;
}

export interface DetectAndPersistAiResultsResult {
    readonly eventsSubmitted: number;
    readonly eventsScored: number;
    readonly anomaliesDetected: number;
    readonly insertedResults: number;
    readonly alreadyPresentResults: number;
    readonly usedFallback: boolean;
    readonly results?: readonly CreateAiResultInput[];
}

/** Joins feature-enriched events to AI inference and idempotent result storage. */
export class DetectAndPersistAiResultsService {
    private readonly organizationId: string;

    public constructor(
        private readonly dependencies: DetectAndPersistAiResultsDependencies,
    ) {
        this.organizationId = requireOrganizationId(dependencies.organizationId);
    }

    public async execute(
        events: readonly FeatureEnrichedEvent[],
    ): Promise<DetectAndPersistAiResultsResult> {
        this.assertOrganizationBoundary(events);
        const detection = await this.dependencies.client.detect(events);
        const eventsById = new Map(events.map((event) => [event.event_id, event]));
        const createdAt = this.dependencies.now();

        const documents: CreateAiResultInput[] = detection.predictions.map((prediction) => {
            const event = eventsById.get(prediction.eventId);
            if (event === undefined) throw new Error("AI prediction does not match an input event.");

            return {
                event_id: event.event_id,
                batch_id: event.ingestion.batch_id,
                model_name: MODEL_NAME,
                model_version: prediction.modelVersion,
                anomaly_score: prediction.anomalyScore,
                is_anomaly: prediction.isAnomaly,
                confidence: prediction.confidence,
                shap_explanation:
                    prediction.shapExplanation === null
                        ? undefined
                        : {
                              base_value: prediction.shapExplanation.baseValue,
                              features: prediction.shapExplanation.features.map((feature) => ({
                                  name: feature.name,
                                  value: feature.value,
                                  shap_value: feature.shapValue,
                              })),
                          },
                input_features: { ...selectAiFeatureVector(event.features) },
                processing_time_ms: Math.round(prediction.processingTimeMs),
                used_fallback: false,
                created_at: createdAt,
                org_id: this.organizationId,
            };
        });

        const persistence = await this.dependencies.results.createManyIfAbsent(documents);

        return Object.freeze({
            eventsSubmitted: detection.stats.eventsSubmitted,
            eventsScored: detection.stats.eventsScored,
            anomaliesDetected: detection.stats.anomaliesDetected,
            insertedResults: persistence.insertedCount,
            alreadyPresentResults: persistence.existingCount,
            usedFallback: detection.stats.usedFallback,
            results: Object.freeze(documents),
        });
    }

    private assertOrganizationBoundary(events: readonly FeatureEnrichedEvent[]): void {
        const crossing = events.find((event) => event.org_id !== this.organizationId);
        if (crossing !== undefined) {
            throw new Error(
                `AI event ${crossing.event_id} crossed the configured organization boundary.`,
            );
        }
    }
}

function requireOrganizationId(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 100) {
        throw new Error("AI organizationId must contain 1 to 100 characters.");
    }
    return normalized;
}
