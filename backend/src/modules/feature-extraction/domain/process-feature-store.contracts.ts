export interface RecordProcessFeatureInput {
    readonly organizationId: string;
    readonly eventId: string;
    readonly occurredAtEpochMs: number;
    readonly endpointIdentity: string;
    readonly processName: string;
    readonly parentProcessName?: string;
}

export interface ProcessFeatureSnapshot {
    readonly replay: boolean;
    readonly processRarityScore: number;
    readonly parentChildAnomaly: number;
}

/**
 * Stateful process-history boundary. Recording history and caching the event
 * snapshot must be one atomic operation so retries cannot double count.
 */
export interface IProcessFeatureStore {
    record(input: RecordProcessFeatureInput): Promise<ProcessFeatureSnapshot>;
}
