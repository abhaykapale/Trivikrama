import type {
    ICollectorTrustStore,
    CollectorTrustResolution,
} from "../domain/collector-verification.contracts.js";

export interface CollectorTrustStoreEntry {
    readonly collectorId: string;
    readonly keyId: string;
    readonly key: Uint8Array;
}

export class InMemoryCollectorTrustStore implements ICollectorTrustStore {
    private readonly collectors = new Map<string, Map<string, Uint8Array>>();

    public constructor(entries: readonly CollectorTrustStoreEntry[]) {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }

    public async resolveKey(collectorId: string, keyId: string): Promise<CollectorTrustResolution> {
        const collectorKeys = this.collectors.get(collectorId);

        if (collectorKeys === undefined) {
            return {
                trusted: false,
                reason: "unknown_collector",
            };
        }

        const key = collectorKeys.get(keyId);

        if (key === undefined) {
            return {
                trusted: false,
                reason: "unknown_key_id",
            };
        }

        /*
         * Return a copy so callers cannot mutate the trust store's
         * internal secret by modifying the returned Uint8Array.
         */
        return {
            trusted: true,
            key: new Uint8Array(key),
        };
    }

    private addEntry(entry: CollectorTrustStoreEntry): void {
        if (entry.collectorId.length === 0) {
            throw new Error("Collector trust entry requires a collector ID.");
        }

        if (entry.keyId.length === 0) {
            throw new Error("Collector trust entry requires a key ID.");
        }

        if (entry.key.length === 0) {
            throw new Error("Collector trust entry requires a non-empty key.");
        }

        let collectorKeys = this.collectors.get(entry.collectorId);

        if (collectorKeys === undefined) {
            collectorKeys = new Map<string, Uint8Array>();

            this.collectors.set(entry.collectorId, collectorKeys);
        }

        if (collectorKeys.has(entry.keyId)) {
            throw new Error(
                `Duplicate trust-store entry for collector '${entry.collectorId}' and key '${entry.keyId}'.`,
            );
        }

        collectorKeys.set(entry.keyId, new Uint8Array(entry.key));
    }
}
