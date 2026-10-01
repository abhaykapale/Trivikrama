import { isIP } from "node:net";

import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    ExtractedFeatureVector,
    FeatureEnrichedEvent,
    FeatureExtractionResult,
    IFeatureExtractor,
} from "../domain/feature-extraction.contracts.js";
import type {
    INetworkFeatureStore,
    NetworkFeatureSnapshot,
} from "../domain/network-feature-store.contracts.js";

const NETWORK_ACTIVITY_CLASS_UID = 4001;
const DNS_ACTIVITY_CLASS_UID = 4003;
export const DEFAULT_KNOWN_BAD_PORTS = Object.freeze([4444, 5555, 6666, 6667, 31337]);

export interface RedisBackedNetworkFeatureExtractorDependencies {
    readonly delegate: IFeatureExtractor;
    readonly networkHistory: INetworkFeatureStore;
    readonly knownBadPorts?: readonly number[];
}

/** Adds OCSF network context while preserving the exact v1 AI payload. */
export class RedisBackedNetworkFeatureExtractor implements IFeatureExtractor {
    private readonly knownBadPorts: ReadonlySet<number>;

    public constructor(
        private readonly dependencies: RedisBackedNetworkFeatureExtractorDependencies,
    ) {
        const ports = dependencies.knownBadPorts ?? DEFAULT_KNOWN_BAD_PORTS;
        for (const port of ports) {
            if (!isValidPort(port)) {
                throw new Error("Known-bad ports must be integers from 1 through 65535.");
            }
        }
        this.knownBadPorts = new Set(ports);
    }

    public async extract(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<FeatureExtractionResult> {
        const delegated = await this.dependencies.delegate.extract(events);
        const output = delegated.events.map((event) =>
            addDeterministicNetworkFeatures(event, this.knownBadPorts),
        );
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
            const sourceIdentity = normalizedOptional(
                event.src_endpoint?.ip ?? event.src_endpoint?.hostname,
            );
            const destinationPort = event.dst_endpoint?.port;
            if (
                event.class_uid !== NETWORK_ACTIVITY_CLASS_UID ||
                sourceIdentity === undefined ||
                !isValidPort(destinationPort)
            ) {
                continue;
            }

            try {
                const snapshot = await this.dependencies.networkHistory.record({
                    organizationId: event.org_id,
                    eventId: event.event_id,
                    occurredAtEpochMs: event.time.getTime(),
                    sourceIdentity,
                    destinationPort,
                });
                output[index] = mergeNetworkHistory(output[index], snapshot);
                applied += 1;
                if (snapshot.replay) replayHits += 1;
            } catch {
                // Redis state is an optimization. Neutral rarity keeps the
                // durable ingestion path available during a Redis outage.
                fallback += 1;
            }
        }

        return Object.freeze({
            ...delegated,
            events: Object.freeze(output),
            totalEvents: output.length,
            networkHistoryAppliedEvents: applied,
            networkHistoryFallbackEvents: fallback,
            networkHistoryReplayHits: replayHits,
        });
    }
}

function addDeterministicNetworkFeatures(
    event: FeatureEnrichedEvent,
    knownBadPorts: ReadonlySet<number>,
): FeatureEnrichedEvent {
    if (event.class_uid !== NETWORK_ACTIVITY_CLASS_UID && event.class_uid !== DNS_ACTIVITY_CLASS_UID) {
        return event;
    }

    const destinationPort = event.dst_endpoint?.port;
    const features: ExtractedFeatureVector = Object.freeze({
        ...event.features,
        is_internal_to_external: isInternalToExternal(
            event.src_endpoint?.ip,
            event.dst_endpoint?.ip,
        ) ? 1 : 0,
        dst_port_rarity: 0,
        connection_duration: finiteNonNegative(event.duration),
        dns_query_length: characterLength(event.query?.hostname),
        is_known_bad_port:
            isValidPort(destinationPort) && knownBadPorts.has(destinationPort) ? 1 : 0,
    });
    assertFinite(features);
    return Object.freeze({ ...event, features });
}

function mergeNetworkHistory(
    event: FeatureEnrichedEvent,
    snapshot: NetworkFeatureSnapshot,
): FeatureEnrichedEvent {
    const features: ExtractedFeatureVector = Object.freeze({
        ...event.features,
        dst_port_rarity: snapshot.destinationPortRarity,
    });
    assertFinite(features);
    return Object.freeze({ ...event, features });
}

export function isInternalToExternal(
    sourceIp: string | undefined,
    destinationIp: string | undefined,
): boolean {
    return isRfc1918Ipv4(sourceIp) && isPublicIpv4(destinationIp);
}

export function isRfc1918Ipv4(value: string | undefined): boolean {
    const octets = ipv4Octets(value);
    if (octets === undefined) return false;
    return (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
    );
}

function isPublicIpv4(value: string | undefined): boolean {
    const octets = ipv4Octets(value);
    if (octets === undefined || isRfc1918Ipv4(value)) return false;
    const [first, second] = octets;
    return !(
        first === 0 ||
        first === 127 ||
        (first === 100 && second! >= 64 && second! <= 127) ||
        (first === 169 && second === 254) ||
        (first === 192 && second === 0 && (octets[2] === 0 || octets[2] === 2)) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && octets[2] === 100) ||
        (first === 203 && second === 0 && octets[2] === 113) ||
        first! >= 224
    );
}

function ipv4Octets(value: string | undefined): readonly number[] | undefined {
    const normalized = normalizedOptional(value);
    if (normalized === undefined || isIP(normalized) !== 4) return undefined;
    return normalized.split(".").map(Number);
}

function finiteNonNegative(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

function characterLength(value: string | undefined): number {
    return value === undefined ? 0 : Array.from(value).length;
}

function isValidPort(value: number | undefined): value is number {
    return Number.isInteger(value) && value !== undefined && value >= 1 && value <= 65_535;
}

function normalizedOptional(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function assertFinite(features: ExtractedFeatureVector): void {
    for (const [name, value] of Object.entries(features)) {
        if (!Number.isFinite(value)) throw new Error(`Feature ${name} must be finite.`);
    }
}
