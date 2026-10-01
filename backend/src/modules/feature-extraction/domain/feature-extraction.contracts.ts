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

/** Context persisted for rules/analysis but not sent to the v1 20-field model. */
export const PROCESS_FEATURE_NAMES = [
    "process_rarity_score",
    "parent_child_anomaly",
    "process_path_depth",
    "command_line_length",
] as const;

export type ProcessFeatureName = (typeof PROCESS_FEATURE_NAMES)[number];
export type ProcessFeatureVector = Readonly<Record<ProcessFeatureName, number>>;

/** Network context persisted for rules/analysis but not sent to the v1 model. */
export const NETWORK_FEATURE_NAMES = [
    "is_internal_to_external",
    "dst_port_rarity",
    "connection_duration",
    "dns_query_length",
    "is_known_bad_port",
] as const;

export type NetworkFeatureName = (typeof NETWORK_FEATURE_NAMES)[number];
export type NetworkFeatureVector = Readonly<Record<NetworkFeatureName, number>>;
export type ExtractedFeatureVector = AiFeatureVector &
    Partial<ProcessFeatureVector> &
    Partial<NetworkFeatureVector>;

export interface FeatureEnrichedEvent extends CreateNormalizedEventInput {
    readonly org_id: string;
    readonly features: ExtractedFeatureVector;
}

export interface FeatureExtractionResult {
    readonly events: readonly FeatureEnrichedEvent[];
    readonly totalEvents: number;
    readonly historyAppliedEvents: number;
    readonly historyFallbackEvents: number;
    readonly historyReplayHits: number;
    readonly authenticationHistoryAppliedEvents: number;
    readonly authenticationHistoryFallbackEvents: number;
    readonly authenticationHistoryReplayHits: number;
    readonly processHistoryAppliedEvents: number;
    readonly processHistoryFallbackEvents: number;
    readonly processHistoryReplayHits: number;
    readonly networkHistoryAppliedEvents: number;
    readonly networkHistoryFallbackEvents: number;
    readonly networkHistoryReplayHits: number;
    readonly pluginsExecuted: readonly string[];
}

export interface IFeatureExtractor {
    extract(events: readonly CreateNormalizedEventInput[]): Promise<FeatureExtractionResult>;
}

/** A named, class-aware extension executed by the feature orchestrator. */
export interface IFeaturePlugin {
    name(): string;
    /** Empty means the plugin applies to every OCSF class. */
    applicableClasses(): readonly number[];
    extract(events: readonly FeatureEnrichedEvent[]): Promise<FeatureExtractionResult>;
}

/**
 * Creates the exact v1 model payload and deliberately discards contextual
 * features until a separately versioned model is trained for them.
 */
export function selectAiFeatureVector(
    features: ExtractedFeatureVector,
): AiFeatureVector {
    return Object.freeze(
        Object.fromEntries(
            AI_FEATURE_NAMES.map((name) => [name, features[name]]),
        ) as unknown as Record<AiFeatureName, number>,
    );
}
