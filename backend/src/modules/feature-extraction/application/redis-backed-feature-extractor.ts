import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    AiFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";
import type {
    IFeatureHistoryStore,
    TemporalFrequencyFeatureSnapshot,
} from "../domain/feature-history-store.contracts.js";

export interface RedisBackedFeatureExtractorDependencies {
    readonly deterministic: IFeatureExtractor;
    readonly history: IFeatureHistoryStore;
}

/**
 * Adds historical Redis features to the deterministic 20-field vector.
 * Events are recorded in event-time order so one batch gives stable deltas.
 * Redis failures are intentionally isolated to the affected event.
 */
export class RedisBackedFeatureExtractor implements IFeatureExtractor {
    public constructor(
        private readonly dependencies: RedisBackedFeatureExtractorDependencies,
    ) {}

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const deterministic = await this.dependencies.deterministic.extract(events);
        const output = [...deterministic.events];
        let applied = 0;
        let fallback = 0;
        let replayHits = 0;

        const orderedIndexes = output
            .map((event, index) => ({ event, index }))
            .sort(
                (left, right) =>
                    left.event.time.getTime() - right.event.time.getTime() ||
                    left.event.event_id.localeCompare(right.event.event_id),
            );

        for (const { event, index } of orderedIndexes) {
            try {
                const snapshot = await this.dependencies.history.record({
                    organizationId: event.org_id,
                    eventId: event.event_id,
                    occurredAtEpochMs: event.time.getTime(),
                    sourceIp: normalizedOptional(event.src_endpoint?.ip),
                    username: normalizedOptional(event.actor?.user?.name),
                    destinationIp: normalizedOptional(event.dst_endpoint?.ip),
                });

                output[index] = mergeSnapshot(event, snapshot);
                applied += 1;
                if (snapshot.replay) replayHits += 1;
            } catch {
                // Redis is a cache, not the system of record. Keep the neutral
                // deterministic values and let ingestion continue.
                fallback += 1;
            }
        }

        return Object.freeze({
            events: Object.freeze(output),
            totalEvents: output.length,
            historyAppliedEvents: applied,
            historyFallbackEvents: fallback,
            historyReplayHits: replayHits,
        });
    }
}

function mergeSnapshot(
    event: FeatureEnrichedEvent,
    snapshot: TemporalFrequencyFeatureSnapshot,
): FeatureEnrichedEvent {
    const features: AiFeatureVector = Object.freeze({
        ...event.features,
        time_since_last_event:
            snapshot.timeSinceLastEventSeconds ??
            event.features.time_since_last_event,
        time_deviation_score: snapshot.timeDeviationScore,
        events_per_minute_src_ip: snapshot.eventsPerMinuteSourceIp,
        events_per_hour_user: snapshot.eventsPerHourUser,
        unique_dst_ips_per_src: snapshot.uniqueDestinationIpsPerSource,
        unique_users_per_src_ip: snapshot.uniqueUsersPerSourceIp,
        frequency_deviation: snapshot.frequencyDeviation,
    });

    for (const [name, value] of Object.entries(features)) {
        if (!Number.isFinite(value)) {
            throw new Error(`Feature ${name} must be finite.`);
        }
    }

    return Object.freeze({ ...event, features });
}

function normalizedOptional(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized === undefined || normalized.length === 0
        ? undefined
        : normalized;
}
