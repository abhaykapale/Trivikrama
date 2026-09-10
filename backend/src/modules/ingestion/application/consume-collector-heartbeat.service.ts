import type {
    CollectorStatusRecord,
    ICollectorStatusRepository,
} from "../../../database/repositories/collector-status/collector-status.repository.js";
import type { CollectorHeartbeat } from "../domain/collector-contract.types.js";
import type { ICollectorHeartbeatFileReader } from "../domain/collector-heartbeat.contracts.js";
import {
    COLLECTOR_HEARTBEAT_ERROR_CODES,
    CollectorHeartbeatError,
} from "../domain/collector-heartbeat.errors.js";
import type {
    ICollectorMessageVerifier,
    Sha256Digest,
} from "../domain/collector-verification.contracts.js";

const DEFAULT_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

type CollectorHeartbeatStatusRepository = Pick<
    ICollectorStatusRepository,
    "findByCollectorId" | "upsertHeartbeat"
>;

export interface ConsumeCollectorHeartbeatDependencies {
    readonly expectedCollectorId: string;
    readonly reader: ICollectorHeartbeatFileReader;
    readonly verifier: ICollectorMessageVerifier;
    readonly collectorStatuses: CollectorHeartbeatStatusRepository;
    readonly now: () => Date;
    readonly maxFutureSkewMs?: number;
    readonly orgId?: string;
}

export type ConsumeCollectorHeartbeatResult =
    | { readonly status: "not_published" }
    | { readonly status: "updated"; readonly collector: CollectorStatusRecord }
    | { readonly status: "replay_ignored"; readonly collector: CollectorStatusRecord }
    | { readonly status: "stale_ignored"; readonly collector: CollectorStatusRecord };

export class ConsumeCollectorHeartbeatService {
    private readonly maxFutureSkewMs: number;

    public constructor(private readonly dependencies: ConsumeCollectorHeartbeatDependencies) {
        this.maxFutureSkewMs =
            dependencies.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;

        if (!Number.isSafeInteger(this.maxFutureSkewMs) || this.maxFutureSkewMs < 0) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.INVALID_CONFIGURATION,
                "maxFutureSkewMs must be a non-negative safe integer.",
            );
        }
    }

    public async execute(): Promise<ConsumeCollectorHeartbeatResult> {
        const snapshot = await this.dependencies.reader.read();

        if (snapshot === null) {
            return { status: "not_published" };
        }

        const verified = await this.dependencies.verifier.verify(snapshot.contents);

        if (verified.message.message_type !== "heartbeat") {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.UNEXPECTED_MESSAGE_TYPE,
                "The Collector heartbeat path contained a non-heartbeat message.",
                { messageType: verified.message.message_type },
            );
        }

        const heartbeat = verified.message;

        if (
            snapshot.collectorId !== this.dependencies.expectedCollectorId ||
            heartbeat.collector_id !== this.dependencies.expectedCollectorId
        ) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.INVALID_CONFIGURATION,
                "Verified heartbeat identity does not match its configured handoff directory.",
            );
        }

        const heartbeatAt = new Date(heartbeat.timestamp);
        const now = this.dependencies.now();

        if (heartbeatAt.getTime() > now.getTime() + this.maxFutureSkewMs) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_FROM_FUTURE,
                "Collector heartbeat timestamp is beyond the allowed clock skew.",
                { collectorId: heartbeat.collector_id },
            );
        }

        const existing = await this.dependencies.collectorStatuses.findByCollectorId(
            heartbeat.collector_id,
        );
        const ordering = compareWithExisting(existing, heartbeat, verified.canonicalUnsignedSha256);

        if (ordering === "replay") {
            return { status: "replay_ignored", collector: existing! };
        }

        if (ordering === "stale") {
            return { status: "stale_ignored", collector: existing! };
        }

        const collector = await this.dependencies.collectorStatuses.upsertHeartbeat({
            collectorId: heartbeat.collector_id,
            status: mapHeartbeatStatus(heartbeat.status),
            lastHeartbeatAt: heartbeatAt,
            heartbeatData: createStoredHeartbeatData(
                heartbeat,
                verified.canonicalUnsignedSha256,
            ),
            eventsCollected: heartbeat.metrics.events_received,
            eventsDropped: heartbeat.metrics.events_lost_best_effort,
            errorsCount: heartbeat.metrics.events_rejected,
            cpuPercent: heartbeat.metrics.cpu_percent,
            memoryMb: heartbeat.metrics.memory_bytes / BYTES_PER_MEBIBYTE,
            orgId: this.dependencies.orgId,
        });

        if (
            collector.lastHeartbeatAt !== null &&
            collector.lastHeartbeatAt.getTime() > heartbeatAt.getTime()
        ) {
            return { status: "stale_ignored", collector };
        }

        return { status: "updated", collector };
    }
}

function compareWithExisting(
    existing: CollectorStatusRecord | null,
    heartbeat: CollectorHeartbeat,
    digest: Sha256Digest,
): "newer" | "replay" | "stale" {
    if (existing === null) {
        return "newer";
    }

    const storedStartedAt = readString(existing.heartbeatData, "started_at");
    const storedSequence = readSafeInteger(existing.heartbeatData, "sequence");
    const storedDigest = readString(existing.heartbeatData, "canonical_unsigned_sha256");

    if (storedStartedAt !== null && storedSequence !== null) {
        const incomingStartedAt = Date.parse(heartbeat.started_at);
        const existingStartedAt = Date.parse(storedStartedAt);

        if (Number.isFinite(existingStartedAt)) {
            if (incomingStartedAt < existingStartedAt) {
                return "stale";
            }

            if (incomingStartedAt === existingStartedAt) {
                if (heartbeat.sequence < storedSequence) {
                    return "stale";
                }

                if (heartbeat.sequence === storedSequence) {
                    if (storedDigest === digest) {
                        return existing.status === mapHeartbeatStatus(heartbeat.status)
                            ? "replay"
                            : "newer";
                    }

                    throw new CollectorHeartbeatError(
                        COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_SEQUENCE_COLLISION,
                        "Collector reused a heartbeat sequence for different signed content.",
                        { collectorId: heartbeat.collector_id, sequence: heartbeat.sequence },
                    );
                }
            }
        }
    }

    if (
        existing.lastHeartbeatAt !== null &&
        Date.parse(heartbeat.timestamp) < existing.lastHeartbeatAt.getTime()
    ) {
        return "stale";
    }

    return "newer";
}

function mapHeartbeatStatus(status: CollectorHeartbeat["status"]): CollectorStatusRecord["status"] {
    return status === "shutting_down" ? "offline" : status;
}

function createStoredHeartbeatData(
    heartbeat: CollectorHeartbeat,
    digest: Sha256Digest,
): Record<string, unknown> {
    return {
        contract_version: heartbeat.contract_version,
        sequence: heartbeat.sequence,
        timestamp: heartbeat.timestamp,
        started_at: heartbeat.started_at,
        collector_version: heartbeat.collector_version,
        configuration_version: heartbeat.configuration_version,
        reported_status: heartbeat.status,
        canonical_unsigned_sha256: digest,
        metrics: { ...heartbeat.metrics },
    };
}

function readString(value: Record<string, unknown>, key: string): string | null {
    return typeof value[key] === "string" ? value[key] : null;
}

function readSafeInteger(value: Record<string, unknown>, key: string): number | null {
    return Number.isSafeInteger(value[key]) ? (value[key] as number) : null;
}
