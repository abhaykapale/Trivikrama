import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    ExtractedFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";
import type {
    IProcessFeatureStore,
    ProcessFeatureSnapshot,
} from "../domain/process-feature-store.contracts.js";

const PROCESS_ACTIVITY_CLASS_UID = 1007;

export interface RedisBackedProcessFeatureExtractorDependencies {
    readonly delegate: IFeatureExtractor;
    readonly processHistory: IProcessFeatureStore;
}

/** Adds OCSF Process Activity context without changing the v1 AI contract. */
export class RedisBackedProcessFeatureExtractor implements IFeatureExtractor {
    public constructor(
        private readonly dependencies: RedisBackedProcessFeatureExtractorDependencies,
    ) {}

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const delegated = await this.dependencies.delegate.extract(events);
        const output = delegated.events.map(addDeterministicProcessFeatures);
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
            const processName = processNameFor(event);
            const endpointIdentity = normalizedOptional(
                event.device?.hostname ?? event.device?.ip,
            );
            if (
                event.class_uid !== PROCESS_ACTIVITY_CLASS_UID ||
                processName === undefined ||
                endpointIdentity === undefined
            ) {
                continue;
            }

            try {
                const snapshot = await this.dependencies.processHistory.record({
                    organizationId: event.org_id,
                    eventId: event.event_id,
                    occurredAtEpochMs: event.time.getTime(),
                    endpointIdentity,
                    processName,
                    parentProcessName: normalizedOptional(event.actor?.process?.name),
                });
                output[index] = mergeProcessHistory(output[index], snapshot);
                applied += 1;
                if (snapshot.replay) replayHits += 1;
            } catch {
                // Redis is disposable feature state. Keep deterministic process
                // context and neutral history values, then continue ingestion.
                fallback += 1;
            }
        }

        return Object.freeze({
            ...delegated,
            events: Object.freeze(output),
            totalEvents: output.length,
            processHistoryAppliedEvents: applied,
            processHistoryFallbackEvents: fallback,
            processHistoryReplayHits: replayHits,
        });
    }
}

function addDeterministicProcessFeatures(
    event: FeatureEnrichedEvent,
): FeatureEnrichedEvent {
    if (event.class_uid !== PROCESS_ACTIVITY_CLASS_UID || processNameFor(event) === undefined) {
        return event;
    }

    const features: ExtractedFeatureVector = Object.freeze({
        ...event.features,
        process_rarity_score: 0,
        parent_child_anomaly: 0,
        process_path_depth: processPathDepth(event.process?.path),
        command_line_length: characterLength(event.process?.cmd_line),
    });
    assertFinite(features);
    return Object.freeze({ ...event, features });
}

function mergeProcessHistory(
    event: FeatureEnrichedEvent,
    snapshot: ProcessFeatureSnapshot,
): FeatureEnrichedEvent {
    const features: ExtractedFeatureVector = Object.freeze({
        ...event.features,
        process_rarity_score: snapshot.processRarityScore,
        parent_child_anomaly: snapshot.parentChildAnomaly,
    });
    assertFinite(features);
    return Object.freeze({ ...event, features });
}

export function processPathDepth(path: string | undefined): number {
    const normalized = normalizedOptional(path);
    if (normalized === undefined) return 0;

    const withoutWindowsDrive = normalized.replace(/^[A-Za-z]:[\\/]/, "");
    return withoutWindowsDrive.split(/[\\/]+/).filter(Boolean).length;
}

function characterLength(value: string | undefined): number {
    return value === undefined ? 0 : Array.from(value).length;
}

function processNameFor(event: FeatureEnrichedEvent): string | undefined {
    return normalizedOptional(event.process?.name);
}

function normalizedOptional(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized === undefined || normalized.length === 0
        ? undefined
        : normalized;
}

function assertFinite(features: ExtractedFeatureVector): void {
    for (const [name, value] of Object.entries(features)) {
        if (!Number.isFinite(value)) {
            throw new Error(`Feature ${name} must be finite.`);
        }
    }
}
