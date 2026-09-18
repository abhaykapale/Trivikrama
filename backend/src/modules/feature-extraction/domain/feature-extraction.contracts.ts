import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";

/**
 * The ordered numeric contract consumed by the AI Engine. Keep this list in
 * lockstep with the model's training metadata; changing the order is a model
 * compatibility change, not a harmless refactor.
 */
export const AI_FEATURE_NAMES = [
    "hour_of_day",
    "day_of_week",
    "is_business_hours",
    "time_since_last_event",
    "time_deviation_score",
    "events_per_minute_src_ip",
    "events_per_hour_user",
    "unique_dst_ips_per_src",
    "unique_users_per_src_ip",
    "frequency_deviation",
    "src_ip_entropy",
    "username_entropy",
    "process_name_entropy",
    "bytes_sent",
    "bytes_received",
    "bytes_ratio",
    "severity_id",
    "failed_login_count_10min",
    "failed_to_success_ratio",
    "new_source_ip",
] as const;

export type AiFeatureName = (typeof AI_FEATURE_NAMES)[number];
export type AiFeatureVector = Readonly<Record<AiFeatureName, number>>;

export interface FeatureEnrichedEvent extends CreateNormalizedEventInput {
    readonly org_id: string;
    readonly features: AiFeatureVector;
}

export interface FeatureExtractionResult {
    readonly events: readonly FeatureEnrichedEvent[];
    readonly totalEvents: number;
    readonly historyAppliedEvents: number;
    readonly historyFallbackEvents: number;
    readonly historyReplayHits: number;
}

export interface IFeatureExtractor {
    extract(events: readonly CreateNormalizedEventInput[]): Promise<FeatureExtractionResult>;
}
