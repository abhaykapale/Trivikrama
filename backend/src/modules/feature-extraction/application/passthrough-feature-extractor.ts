import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";

/**
 * Supplies an already-enriched batch to one legacy extractor decorator.
 * This small adapter lets existing, tested extractors become plugins without
 * duplicating their feature logic.
 */
export class PassthroughFeatureExtractor implements IFeatureExtractor {
    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const enriched = events.map(assertEnrichedEvent);
        return Object.freeze({
            events: Object.freeze(enriched),
            totalEvents: enriched.length,
            historyAppliedEvents: 0,
            historyFallbackEvents: 0,
            historyReplayHits: 0,
            authenticationHistoryAppliedEvents: 0,
            authenticationHistoryFallbackEvents: 0,
            authenticationHistoryReplayHits: 0,
            processHistoryAppliedEvents: 0,
            processHistoryFallbackEvents: 0,
            processHistoryReplayHits: 0,
            networkHistoryAppliedEvents: 0,
            networkHistoryFallbackEvents: 0,
            networkHistoryReplayHits: 0,
            pluginsExecuted: Object.freeze([]),
        });
    }
}

function assertEnrichedEvent(event: CreateNormalizedEventInput): FeatureEnrichedEvent {
    if (event.org_id === undefined || event.features === undefined) {
        throw new Error("Feature plugins require events enriched by the base extractor.");
    }
    return event as FeatureEnrichedEvent;
}
