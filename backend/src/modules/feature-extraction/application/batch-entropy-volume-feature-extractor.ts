import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    AiFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";

export interface BatchEntropyVolumeFeatureExtractorDependencies {
    readonly delegate: IFeatureExtractor;
}

interface VolumeSnapshot {
    readonly bytesSent: number;
    readonly bytesReceived: number;
    readonly bytesRatio: number;
}

const OUTBOUND_BYTE_PATHS = [
    ["traffic", "bytes_out"],
    ["traffic", "bytes_sent"],
    ["network", "bytes_sent"],
    ["bytes_sent"],
    ["bytes_out"],
] as const;

const INBOUND_BYTE_PATHS = [
    ["traffic", "bytes_in"],
    ["traffic", "bytes_received"],
    ["network", "bytes_received"],
    ["bytes_received"],
    ["bytes_in"],
] as const;

/**
 * Adds features that need the complete Collector batch rather than history.
 *
 * The decorator is deliberately placed outside the Redis extractor. Redis can
 * fail independently while batch entropy and per-event volume still remain
 * available. Grouping by both organization and batch protects tenant
 * boundaries if a caller accidentally supplies a mixed input array.
 */
export class BatchEntropyVolumeFeatureExtractor implements IFeatureExtractor {
    public constructor(
        private readonly dependencies: BatchEntropyVolumeFeatureExtractorDependencies,
    ) {}

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const delegated = await this.dependencies.delegate.extract(events);
        const sourceEntropyByBatch = calculateSourceEntropyByBatch(delegated.events);
        const enriched = delegated.events.map((event) =>
            mergeBatchFeatures(
                event,
                sourceEntropyByBatch.get(batchBoundary(event)) ?? 0,
                extractVolume(event),
            ),
        );

        return Object.freeze({
            ...delegated,
            events: Object.freeze(enriched),
            totalEvents: enriched.length,
        });
    }
}

/** Shannon entropy of a categorical distribution, measured in bits. */
export function shannonDistributionEntropy(
    values: readonly (string | undefined)[],
): number {
    const normalized = values
        .map((value) => value?.trim())
        .filter((value): value is string => value !== undefined && value.length > 0);

    if (normalized.length === 0) return 0;

    const occurrences = new Map<string, number>();
    for (const value of normalized) {
        occurrences.set(value, (occurrences.get(value) ?? 0) + 1);
    }

    let entropy = 0;
    for (const count of occurrences.values()) {
        const probability = count / normalized.length;
        entropy -= probability * Math.log2(probability);
    }

    return entropy;
}

function calculateSourceEntropyByBatch(
    events: readonly FeatureEnrichedEvent[],
): ReadonlyMap<string, number> {
    const sourceIpsByBatch = new Map<string, Array<string | undefined>>();

    for (const event of events) {
        const key = batchBoundary(event);
        const values = sourceIpsByBatch.get(key) ?? [];
        values.push(event.src_endpoint?.ip);
        sourceIpsByBatch.set(key, values);
    }

    return new Map(
        [...sourceIpsByBatch].map(([key, values]) => [
            key,
            shannonDistributionEntropy(values),
        ]),
    );
}

function batchBoundary(event: FeatureEnrichedEvent): string {
    return `${event.org_id}\u0000${event.ingestion.batch_id}`;
}

function extractVolume(event: FeatureEnrichedEvent): VolumeSnapshot {
    const sources: readonly Record<string, unknown>[] = [
        event as unknown as Record<string, unknown>,
        event.unmapped ?? {},
        event.raw_event ?? {},
    ];
    const bytesSent = firstNonNegativeNumber(sources, OUTBOUND_BYTE_PATHS) ?? 0;
    const bytesReceived = firstNonNegativeNumber(sources, INBOUND_BYTE_PATHS) ?? 0;

    let bytesRatio = 1;
    if (bytesSent !== 0 || bytesReceived !== 0) {
        bytesRatio = bytesReceived === 0 ? bytesSent : bytesSent / bytesReceived;
    }

    if (!Number.isFinite(bytesRatio)) {
        bytesRatio = bytesSent;
    }

    return Object.freeze({ bytesSent, bytesReceived, bytesRatio });
}

function firstNonNegativeNumber(
    sources: readonly Record<string, unknown>[],
    paths: readonly (readonly string[])[],
): number | undefined {
    for (const source of sources) {
        for (const path of paths) {
            const value = readPath(source, path);
            const number = toNonNegativeNumber(value);
            if (number !== undefined) return number;
        }
    }

    return undefined;
}

function readPath(
    source: Record<string, unknown>,
    path: readonly string[],
): unknown {
    let current: unknown = source;

    for (const segment of path) {
        if (!isRecord(current)) return undefined;
        current = current[segment];
    }

    return current;
}

function toNonNegativeNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? value : undefined;
    }

    if (typeof value !== "string" || value.trim().length === 0) return undefined;

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeBatchFeatures(
    event: FeatureEnrichedEvent,
    sourceIpEntropy: number,
    volume: VolumeSnapshot,
): FeatureEnrichedEvent {
    const features: AiFeatureVector = Object.freeze({
        ...event.features,
        src_ip_entropy: sourceIpEntropy,
        bytes_sent: volume.bytesSent,
        bytes_received: volume.bytesReceived,
        bytes_ratio: volume.bytesRatio,
    });

    for (const [name, value] of Object.entries(features)) {
        if (!Number.isFinite(value)) {
            throw new Error(`Feature ${name} must be finite.`);
        }
    }

    return Object.freeze({ ...event, features });
}
