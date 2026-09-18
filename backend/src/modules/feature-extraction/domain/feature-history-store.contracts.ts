export interface RecordFeatureHistoryInput {
    readonly organizationId: string;
    readonly eventId: string;
    readonly occurredAtEpochMs: number;
    readonly sourceIp?: string;
    readonly username?: string;
    readonly destinationIp?: string;
}

export interface TemporalFrequencyFeatureSnapshot {
    readonly replay: boolean;
    readonly timeSinceLastEventSeconds: number | null;
    readonly timeDeviationScore: number;
    readonly eventsPerMinuteSourceIp: number;
    readonly eventsPerHourUser: number;
    readonly uniqueDestinationIpsPerSource: number;
    readonly uniqueUsersPerSourceIp: number;
    readonly frequencyDeviation: number;
}

/**
 * Stateful feature boundary. Implementations must record one event and return
 * its snapshot atomically so concurrent workers cannot observe partial state.
 */
export interface IFeatureHistoryStore {
    record(
        input: RecordFeatureHistoryInput,
    ): Promise<TemporalFrequencyFeatureSnapshot>;
}
