import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    AiFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";

export interface DeterministicFeatureExtractorOptions {
    /** Must eventually match the trained model's imputation metadata. */
    readonly timeSinceLastEventDefaultSeconds?: number;
    readonly businessHourStartUtc?: number;
    readonly businessHourEndUtc?: number;
}

interface ResolvedOptions {
    readonly timeSinceLastEventDefaultSeconds: number;
    readonly businessHourStartUtc: number;
    readonly businessHourEndUtc: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
    timeSinceLastEventDefaultSeconds: 0,
    businessHourStartUtc: 9,
    businessHourEndUtc: 17,
};

/**
 * Builds the model's feature contract without I/O or mutable state. The same
 * normalized event and configuration therefore always produce the same vector.
 */
export class DeterministicFeatureExtractor implements IFeatureExtractor {
    private readonly options: ResolvedOptions;

    public constructor(options: DeterministicFeatureExtractorOptions = {}) {
        this.options = resolveOptions(options);
    }

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const enrichedEvents = events.map((event) => this.enrich(event));

        return Object.freeze({
            events: Object.freeze(enrichedEvents),
            totalEvents: enrichedEvents.length,
            historyAppliedEvents: 0,
            historyFallbackEvents: 0,
            historyReplayHits: 0,
        });
    }

    private enrich(event: CreateNormalizedEventInput): FeatureEnrichedEvent {
        validateEvent(event);

        const hour = event.time.getUTCHours();
        // JavaScript uses Sunday=0. The model contract uses Monday=0.
        const dayOfWeek = (event.time.getUTCDay() + 6) % 7;
        const isWeekday = dayOfWeek < 5;
        const isBusinessHours =
            isWeekday &&
            hour >= this.options.businessHourStartUtc &&
            hour < this.options.businessHourEndUtc;

        const features: AiFeatureVector = Object.freeze({
            hour_of_day: hour,
            day_of_week: dayOfWeek,
            is_business_hours: isBusinessHours ? 1 : 0,
            time_since_last_event: this.options.timeSinceLastEventDefaultSeconds,
            time_deviation_score: 0,
            events_per_minute_src_ip: 0,
            events_per_hour_user: 0,
            unique_dst_ips_per_src: 1,
            unique_users_per_src_ip: 1,
            frequency_deviation: 0,
            src_ip_entropy: shannonCharacterEntropy(event.src_endpoint?.ip),
            username_entropy: shannonCharacterEntropy(event.actor?.user?.name),
            process_name_entropy: shannonCharacterEntropy(event.actor?.process?.name),
            bytes_sent: 0,
            bytes_received: 0,
            bytes_ratio: 1,
            severity_id: event.severity_id,
            failed_login_count_10min: 0,
            failed_to_success_ratio: 0,
            new_source_ip: 0,
        });

        assertFiniteFeatureVector(features);

        return Object.freeze({
            ...event,
            org_id: event.org_id as string,
            features,
        });
    }
}

export function shannonCharacterEntropy(value: string | undefined): number {
    if (value === undefined || value.length === 0) {
        return 0;
    }

    const occurrences = new Map<string, number>();

    for (const character of value) {
        occurrences.set(character, (occurrences.get(character) ?? 0) + 1);
    }

    let entropy = 0;

    for (const count of occurrences.values()) {
        const probability = count / value.length;
        entropy -= probability * Math.log2(probability);
    }

    return entropy;
}

function resolveOptions(
    options: DeterministicFeatureExtractorOptions,
): ResolvedOptions {
    const resolved = { ...DEFAULT_OPTIONS, ...options };

    assertFiniteNonNegative(
        "timeSinceLastEventDefaultSeconds",
        resolved.timeSinceLastEventDefaultSeconds,
    );
    assertUtcHour("businessHourStartUtc", resolved.businessHourStartUtc);
    assertUtcHour("businessHourEndUtc", resolved.businessHourEndUtc);

    if (resolved.businessHourStartUtc >= resolved.businessHourEndUtc) {
        throw new Error("businessHourStartUtc must be earlier than businessHourEndUtc.");
    }

    return Object.freeze(resolved);
}

function validateEvent(event: CreateNormalizedEventInput): void {
    if (event.event_id.trim().length === 0) {
        throw new Error("Feature extraction requires a non-empty event_id.");
    }

    if (event.org_id === undefined || event.org_id.trim().length === 0) {
        throw new Error("Feature extraction requires a trusted organization boundary.");
    }

    if (Number.isNaN(event.time.getTime())) {
        throw new Error("Feature extraction requires a valid event time.");
    }

    if (!Number.isSafeInteger(event.severity_id) || event.severity_id < 0) {
        throw new Error("Feature extraction requires a non-negative integer severity_id.");
    }
}

function assertFiniteFeatureVector(features: AiFeatureVector): void {
    for (const [name, value] of Object.entries(features)) {
        if (!Number.isFinite(value)) {
            throw new Error(`Feature ${name} must be finite.`);
        }
    }
}

function assertFiniteNonNegative(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a finite non-negative number.`);
    }
}

function assertUtcHour(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 24) {
        throw new Error(`${name} must be an integer from 0 through 24.`);
    }
}
