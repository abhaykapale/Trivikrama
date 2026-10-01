import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    AiFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";
import type {
    AuthenticationFeatureSnapshot,
    AuthenticationOutcome,
    IAuthenticationFeatureStore,
} from "../domain/authentication-feature-store.contracts.js";

export interface RedisBackedAuthenticationFeatureExtractorDependencies {
    readonly delegate: IFeatureExtractor;
    readonly authenticationHistory: IAuthenticationFeatureStore;
}

/** Adds Redis authentication history only to OCSF Authentication events. */
export class RedisBackedAuthenticationFeatureExtractor implements IFeatureExtractor {
    public constructor(
        private readonly dependencies: RedisBackedAuthenticationFeatureExtractorDependencies,
    ) {}

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const delegated = await this.dependencies.delegate.extract(events);
        const output = [...delegated.events];
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
            const outcome = authenticationOutcome(event);
            const username = normalizedOptional(event.actor?.user?.name);
            if (outcome === null || username === undefined) continue;

            try {
                const snapshot = await this.dependencies.authenticationHistory.record({
                    organizationId: event.org_id,
                    eventId: event.event_id,
                    occurredAtEpochMs: event.time.getTime(),
                    username,
                    sourceIp: normalizedOptional(event.src_endpoint?.ip),
                    outcome,
                });
                output[index] = mergeAuthenticationSnapshot(event, snapshot);
                applied += 1;
                if (snapshot.replay) replayHits += 1;
            } catch {
                // Authentication history is a disposable feature cache. Keep
                // the delegate's neutral values and continue ingestion.
                fallback += 1;
            }
        }

        return Object.freeze({
            ...delegated,
            events: Object.freeze(output),
            totalEvents: output.length,
            authenticationHistoryAppliedEvents: applied,
            authenticationHistoryFallbackEvents: fallback,
            authenticationHistoryReplayHits: replayHits,
        });
    }
}

function authenticationOutcome(
    event: FeatureEnrichedEvent,
): AuthenticationOutcome | null {
    if (event.class_uid !== 3002) return null;
    if (event.status_id === 1) return "success";
    if (event.status_id === 2) return "failure";
    return null;
}

function mergeAuthenticationSnapshot(
    event: FeatureEnrichedEvent,
    snapshot: AuthenticationFeatureSnapshot,
): FeatureEnrichedEvent {
    const features: AiFeatureVector = Object.freeze({
        ...event.features,
        failed_login_count_10min: snapshot.failedLoginCount10Minutes,
        failed_to_success_ratio: snapshot.failedToSuccessRatio,
        new_source_ip: snapshot.newSourceIp,
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
