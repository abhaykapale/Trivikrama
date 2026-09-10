import assert from "node:assert/strict";
import test from "node:test";

import { loadCollectorHeartbeatRuntimeSettings } from "../../../src/config/collector-heartbeat.env.js";
import type {
    CollectorStatusRecord,
    UpsertCollectorStatusInput,
} from "../../../src/database/repositories/collector-status/collector-status.repository.js";
import { ConsumeCollectorHeartbeatService } from "../../../src/modules/ingestion/application/consume-collector-heartbeat.service.js";
import { MarkStaleCollectorsOfflineService } from "../../../src/modules/ingestion/application/mark-stale-collectors-offline.service.js";
import type {
    CollectorEventBatch,
    CollectorHeartbeat,
} from "../../../src/modules/ingestion/domain/collector-contract.types.js";
import type { CollectorHeartbeatSnapshot } from "../../../src/modules/ingestion/domain/collector-heartbeat.contracts.js";
import { CollectorHeartbeatError } from "../../../src/modules/ingestion/domain/collector-heartbeat.errors.js";
import type {
    ICollectorMessageVerifier,
    Sha256Digest,
    VerifiedCollectorMessage,
} from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";

const COLLECTOR_ID = "collector-dev-01";
const NOW = new Date("2026-09-09T12:00:00.000Z");
const STARTED_AT = "2026-09-09T11:00:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}` as Sha256Digest;
const DIGEST_B = `sha256:${"b".repeat(64)}` as Sha256Digest;

test("persists a verified heartbeat without storing its HMAC", async () => {
    const heartbeat = createHeartbeat();
    const repository = new FakeCollectorStatusRepository();
    const service = createService(heartbeat, DIGEST_A, repository);

    const result = await service.execute();

    assert.equal(result.status, "updated");
    assert.equal(repository.inputs.length, 1);
    assert.equal(repository.inputs[0]?.status, "online");
    assert.equal(repository.inputs[0]?.eventsCollected, 200);
    assert.equal(repository.inputs[0]?.eventsDropped, 2);
    assert.equal(repository.inputs[0]?.errorsCount, 3);
    assert.equal(repository.inputs[0]?.memoryMb, 128);
    assert.equal(
        JSON.stringify(repository.inputs[0]?.heartbeatData).includes(heartbeat.integrity.value),
        false,
    );
});

test("maps a graceful Collector shutdown to offline", async () => {
    const repository = new FakeCollectorStatusRepository();
    const service = createService(
        createHeartbeat({ status: "shutting_down" }),
        DIGEST_A,
        repository,
    );

    const result = await service.execute();

    assert.equal(result.status, "updated");
    assert.equal(repository.inputs[0]?.status, "offline");
});

test("ignores an exact heartbeat replay idempotently", async () => {
    const repository = new FakeCollectorStatusRepository(
        createStoredRecord(createHeartbeat(), DIGEST_A),
    );
    const service = createService(createHeartbeat(), DIGEST_A, repository);

    const result = await service.execute();

    assert.equal(result.status, "replay_ignored");
    assert.equal(repository.inputs.length, 0);
});

test("reapplies a fresh replay when an offline row must be revived", async () => {
    const heartbeat = createHeartbeat();
    const offlineRecord = { ...createStoredRecord(heartbeat, DIGEST_A), status: "offline" as const };
    const repository = new FakeCollectorStatusRepository(offlineRecord);
    const service = createService(heartbeat, DIGEST_A, repository);

    const result = await service.execute();

    assert.equal(result.status, "updated");
    assert.equal(result.collector.status, "online");
    assert.equal(repository.inputs.length, 1);
});

test("ignores an older heartbeat sequence from the same Collector process", async () => {
    const existingHeartbeat = createHeartbeat({ sequence: 8, timestamp: "2026-09-09T11:59:50.000Z" });
    const repository = new FakeCollectorStatusRepository(
        createStoredRecord(existingHeartbeat, DIGEST_A),
    );
    const staleHeartbeat = createHeartbeat({ sequence: 7, timestamp: "2026-09-09T11:59:55.000Z" });
    const service = createService(staleHeartbeat, DIGEST_B, repository);

    const result = await service.execute();

    assert.equal(result.status, "stale_ignored");
    assert.equal(repository.inputs.length, 0);
});

test("rejects sequence reuse with different signed content", async () => {
    const heartbeat = createHeartbeat();
    const repository = new FakeCollectorStatusRepository(createStoredRecord(heartbeat, DIGEST_A));
    const service = createService(heartbeat, DIGEST_B, repository);

    await assert.rejects(
        service.execute(),
        (error: unknown) =>
            error instanceof CollectorHeartbeatError &&
            error.code === "HEARTBEAT_SEQUENCE_COLLISION",
    );
});

test("rejects a heartbeat beyond the configured future clock skew", async () => {
    const repository = new FakeCollectorStatusRepository();
    const future = createHeartbeat({ timestamp: "2026-09-09T12:02:01.000Z" });
    const service = createService(future, DIGEST_A, repository);

    await assert.rejects(
        service.execute(),
        (error: unknown) =>
            error instanceof CollectorHeartbeatError && error.code === "HEARTBEAT_FROM_FUTURE",
    );
});

test("rejects a validly verified non-heartbeat message on the heartbeat path", async () => {
    const repository = new FakeCollectorStatusRepository();
    const verifier = new FakeVerifier({
        message: { message_type: "event_batch" } as CollectorEventBatch,
        canonicalUnsignedBytes: new Uint8Array([1]),
        canonicalUnsignedSha256: DIGEST_A,
    });
    const service = new ConsumeCollectorHeartbeatService({
        expectedCollectorId: COLLECTOR_ID,
        reader: new FakeReader(),
        verifier,
        collectorStatuses: repository,
        now: () => NOW,
    });

    await assert.rejects(
        service.execute(),
        (error: unknown) =>
            error instanceof CollectorHeartbeatError && error.code === "UNEXPECTED_MESSAGE_TYPE",
    );
});

test("marks active Collector rows offline after the stale threshold", async () => {
    let receivedCutoff: Date | undefined;
    let receivedOrgId: string | undefined;
    const service = new MarkStaleCollectorsOfflineService({
        collectorStatuses: {
            markStaleOffline: async (cutoff, orgId) => {
                receivedCutoff = cutoff;
                receivedOrgId = orgId;
                return 2;
            },
        },
        now: () => NOW,
        staleAfterMs: 90_000,
        orgId: "org-test",
    });

    const result = await service.execute();

    assert.equal(receivedCutoff?.toISOString(), "2026-09-09T11:58:30.000Z");
    assert.equal(receivedOrgId, "org-test");
    assert.equal(result.markedOffline, 2);
});

test("loads isolated heartbeat timing defaults and validates overrides", () => {
    assert.deepEqual(loadCollectorHeartbeatRuntimeSettings({}), {
        pollIntervalMs: 5_000,
        staleAfterMs: 90_000,
        maxFutureSkewMs: 120_000,
    });

    assert.throws(
        () =>
            loadCollectorHeartbeatRuntimeSettings({
                COLLECTOR_HEARTBEAT_STALE_AFTER_MS: "0",
            }),
        /COLLECTOR_HEARTBEAT_STALE_AFTER_MS/u,
    );
});

function createService(
    heartbeat: CollectorHeartbeat,
    digest: Sha256Digest,
    repository: FakeCollectorStatusRepository,
): ConsumeCollectorHeartbeatService {
    return new ConsumeCollectorHeartbeatService({
        expectedCollectorId: COLLECTOR_ID,
        reader: new FakeReader(),
        verifier: new FakeVerifier({
            message: heartbeat,
            canonicalUnsignedBytes: new Uint8Array([1, 2, 3]),
            canonicalUnsignedSha256: digest,
        }),
        collectorStatuses: repository,
        now: () => NOW,
        maxFutureSkewMs: 120_000,
    });
}

function createHeartbeat(
    overrides: Partial<Pick<CollectorHeartbeat, "sequence" | "timestamp" | "status" | "started_at">> = {},
): CollectorHeartbeat {
    return {
        contract_version: "1.0.0",
        message_type: "heartbeat",
        collector_id: COLLECTOR_ID,
        sequence: overrides.sequence ?? 7,
        timestamp: overrides.timestamp ?? "2026-09-09T11:59:30.000Z",
        started_at: overrides.started_at ?? STARTED_AT,
        collector_version: "1.0.0",
        configuration_version: "config-v1",
        status: overrides.status ?? "online",
        metrics: {
            events_received: 200,
            events_published: 195,
            events_rejected: 3,
            events_lost_best_effort: 2,
            queue_events: 4,
            queue_bytes: 1024,
            outbox_batches: 1,
            outbox_bytes: 2048,
            last_batch_id: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
            cpu_percent: 12.5,
            memory_bytes: 128 * 1024 * 1024,
            disk_available_bytes: 20 * 1024 * 1024,
        },
        integrity: {
            algorithm: "HMAC-SHA256",
            key_id: "collector-key-test-01",
            value: "x".repeat(43),
        },
    };
}

function createStoredRecord(
    heartbeat: CollectorHeartbeat,
    digest: Sha256Digest,
): CollectorStatusRecord {
    return {
        id: "c9e40d12-e6ff-44b8-b5e6-505639615a7d",
        collectorId: heartbeat.collector_id,
        status: heartbeat.status === "shutting_down" ? "offline" : heartbeat.status,
        lastHeartbeatAt: new Date(heartbeat.timestamp),
        heartbeatData: {
            sequence: heartbeat.sequence,
            started_at: heartbeat.started_at,
            canonical_unsigned_sha256: digest,
        },
        filesProcessed: 0,
        eventsCollected: heartbeat.metrics.events_received,
        eventsDropped: heartbeat.metrics.events_lost_best_effort,
        errorsCount: heartbeat.metrics.events_rejected,
        cpuPercent: heartbeat.metrics.cpu_percent,
        memoryMb: heartbeat.metrics.memory_bytes / (1024 * 1024),
        firstSeenAt: new Date(heartbeat.started_at),
        updatedAt: new Date(heartbeat.timestamp),
        orgId: "default",
    };
}

class FakeReader {
    public async read(): Promise<CollectorHeartbeatSnapshot> {
        return {
            collectorId: COLLECTOR_ID,
            filePath: `/incoming/${COLLECTOR_ID}/heartbeat.json`,
            byteLength: 3,
            contents: new Uint8Array([1, 2, 3]),
        };
    }
}

class FakeVerifier implements ICollectorMessageVerifier {
    public constructor(private readonly result: VerifiedCollectorMessage) {}

    public async verify(): Promise<VerifiedCollectorMessage> {
        return this.result;
    }
}

class FakeCollectorStatusRepository {
    public readonly inputs: UpsertCollectorStatusInput[] = [];

    public constructor(private record: CollectorStatusRecord | null = null) {}

    public async findByCollectorId(): Promise<CollectorStatusRecord | null> {
        return this.record;
    }

    public async upsertHeartbeat(input: UpsertCollectorStatusInput): Promise<CollectorStatusRecord> {
        this.inputs.push(input);
        const heartbeatAt = input.lastHeartbeatAt ?? NOW;
        this.record = {
            id: this.record?.id ?? "c9e40d12-e6ff-44b8-b5e6-505639615a7d",
            collectorId: input.collectorId,
            status: input.status,
            lastHeartbeatAt: heartbeatAt,
            heartbeatData: input.heartbeatData ?? {},
            filesProcessed: input.filesProcessed ?? this.record?.filesProcessed ?? 0,
            eventsCollected: input.eventsCollected ?? 0,
            eventsDropped: input.eventsDropped ?? 0,
            errorsCount: input.errorsCount ?? 0,
            cpuPercent: input.cpuPercent ?? null,
            memoryMb: input.memoryMb ?? null,
            firstSeenAt: this.record?.firstSeenAt ?? NOW,
            updatedAt: NOW,
            orgId: input.orgId ?? "default",
        };
        return this.record;
    }
}
