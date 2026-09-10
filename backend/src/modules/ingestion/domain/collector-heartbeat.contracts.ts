/** ARCH-01 heartbeat snapshots are small operational messages, not event batches. */
export const MAX_COLLECTOR_HEARTBEAT_BYTES = 64 * 1024;

export interface CollectorHeartbeatSnapshot {
    readonly collectorId: string;
    readonly filePath: string;
    readonly byteLength: number;
    readonly contents: Uint8Array;
}

export interface ICollectorHeartbeatFileReader {
    /** Returns null until the Collector has published its first heartbeat. */
    read(): Promise<CollectorHeartbeatSnapshot | null>;
}

