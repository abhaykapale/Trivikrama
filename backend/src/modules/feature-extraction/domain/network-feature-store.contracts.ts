export interface RecordNetworkFeatureInput {
    readonly organizationId: string;
    readonly eventId: string;
    readonly occurredAtEpochMs: number;
    readonly sourceIdentity: string;
    readonly destinationPort: number;
}

export interface NetworkFeatureSnapshot {
    readonly replay: boolean;
    /** 1 means unseen in the source's 24-hour history; 0 means every prior event used it. */
    readonly destinationPortRarity: number;
}

export interface INetworkFeatureStore {
    record(input: RecordNetworkFeatureInput): Promise<NetworkFeatureSnapshot>;
}
