import assert from "node:assert/strict";
import test from "node:test";

import { VerifyAndQueueClaimedBatchService } from "../../../src/modules/ingestion/application/verify-and-queue-claimed-batch.service.js";
import type {
    ClaimedCollectorBatchFile,
    CollectorBatchQuarantineReason,
    CollectorFileIntakeReport,
    CollectorFileRecoveryReport,
    ICollectorFileIntake,
    QuarantinedCollectorBatchFile,
} from "../../../src/modules/ingestion/domain/collector-file-intake.contracts.js";
import type { IClaimedCollectorBatchReader } from "../../../src/modules/ingestion/domain/claimed-collector-batch-reader.contracts.js";
import type { CollectorEventBatch } from "../../../src/modules/ingestion/domain/collector-contract.types.js";
import type {
    ICollectorMessageVerifier,
    VerifiedCollectorMessage,
} from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";
import { CollectorVerificationError } from "../../../src/modules/ingestion/domain/collector-verification.errors.js";
import type {
    CollectorProcessingJob,
    IProcessingQueue,
    ProcessingQueueEnqueueResult,
} from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";

const CLAIMED_FILE: ClaimedCollectorBatchFile = {
    collectorId: "collector-dev-01",
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    claimId: "f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d",
    originalFileName: "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377.json",
    processingFileName:
        "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_collector-dev-01__claim_f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d.json",
    processingPath: "/collector/processing/batch.json",
    byteLength: 100,
    claimedAt: "2026-09-05T12:00:00.000Z",
};

function createVerifiedBatch(changes: Partial<CollectorEventBatch> = {}): VerifiedCollectorMessage {
    const message: CollectorEventBatch = {
        contract_version: "1.0.0",
        message_type: "event_batch",
        collector_id: CLAIMED_FILE.collectorId,
        integrity: {
            algorithm: "HMAC-SHA256",
            key_id: "collector-dev-01-key-01",
            value: "a".repeat(43),
        },
        batch_id: CLAIMED_FILE.batchId,
        created_at: "2026-09-05T12:00:00.000Z",
        ocsf_schema_version: "1.1.0",
        event_count: 0,
        events: [],
        ...changes,
    };

    return {
        message,
        canonicalUnsignedBytes: new Uint8Array([1, 2, 3]),
        canonicalUnsignedSha256:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
}

class FakeFileIntake implements ICollectorFileIntake {
    public readonly quarantined: Array<{
        claimedFile: ClaimedCollectorBatchFile;
        reason: string;
    }> = [];

    public async initialize(): Promise<void> {}

    public async claimPublishedBatches(): Promise<CollectorFileIntakeReport> {
        return {
            claimed: [],
            quarantined: [],
            ignored: [],
        };
    }

    public async recoverClaimedBatches(): Promise<CollectorFileRecoveryReport> {
        return {
            recovered: [],
            quarantined: [],
            ignored: [],
        };
    }

    public async quarantineClaimedBatch(
        claimedFile: ClaimedCollectorBatchFile,
        reason: QuarantinedCollectorBatchFile["quarantineReason"],
    ): Promise<QuarantinedCollectorBatchFile> {
        this.quarantined.push({ claimedFile, reason });

        return {
            ...claimedFile,
            quarantineFileName: `${claimedFile.batchId}.json`,
            quarantinePath: `/collector/quarantine/${claimedFile.batchId}.json`,
            quarantineReason: reason,
            quarantinedAt: "2026-09-05T12:00:00.000Z",
        };
    }

    public async quarantineProcessingJob(
        _job: CollectorProcessingJob,
        _reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile> {
        throw new Error("quarantineProcessingJob is not used by this BE-ING-01C test.");
    }
}

class FakeReader implements IClaimedCollectorBatchReader {
    public async read(_claimedFile: ClaimedCollectorBatchFile): Promise<Uint8Array> {
        return new Uint8Array([123, 125]);
    }
}

class FakeVerifier implements ICollectorMessageVerifier {
    public constructor(
        private readonly outcome: VerifiedCollectorMessage | CollectorVerificationError,
    ) {}

    public async verify(_input: Uint8Array): Promise<VerifiedCollectorMessage> {
        if (this.outcome instanceof CollectorVerificationError) {
            throw this.outcome;
        }

        return this.outcome;
    }
}

class FakeProcessingQueue implements IProcessingQueue {
    public readonly jobs: CollectorProcessingJob[] = [];

    public constructor(private readonly outcome: ProcessingQueueEnqueueResult | Error) {}

    public async enqueue(job: CollectorProcessingJob): Promise<ProcessingQueueEnqueueResult> {
        if (this.outcome instanceof Error) {
            throw this.outcome;
        }

        this.jobs.push(job);

        return this.outcome;
    }

    public async close(): Promise<void> {}
}

test("queues an authenticated claimed event batch", async () => {
    const fileIntake = new FakeFileIntake();
    const processingQueue = new FakeProcessingQueue({
        status: "enqueued",
        jobId: CLAIMED_FILE.batchId,
    });

    const service = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader: new FakeReader(),
        verifier: new FakeVerifier(createVerifiedBatch()),
        processingQueue,
    });

    const result = await service.execute(CLAIMED_FILE);

    assert.deepEqual(result, {
        status: "enqueued",
        jobId: CLAIMED_FILE.batchId,
    });
    assert.equal(processingQueue.jobs.length, 1);
    assert.equal(processingQueue.jobs[0]?.batchId, CLAIMED_FILE.batchId);
    assert.equal(processingQueue.jobs[0]?.collectorId, CLAIMED_FILE.collectorId);
    assert.equal(fileIntake.quarantined.length, 0);
});

test("quarantines a Collector message with an invalid HMAC", async () => {
    const fileIntake = new FakeFileIntake();
    const processingQueue = new FakeProcessingQueue({
        status: "enqueued",
        jobId: CLAIMED_FILE.batchId,
    });

    const service = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader: new FakeReader(),
        verifier: new FakeVerifier(
            new CollectorVerificationError(
                "INVALID_HMAC",
                "integrity",
                "Collector message HMAC verification failed.",
            ),
        ),
        processingQueue,
    });

    const result = await service.execute(CLAIMED_FILE);

    assert.deepEqual(result, {
        status: "quarantined",
        reason: "INVALID_HMAC",
    });
    assert.equal(processingQueue.jobs.length, 0);
    assert.equal(fileIntake.quarantined.length, 1);
    assert.equal(fileIntake.quarantined[0]?.reason, "INVALID_HMAC");
});

test("quarantines a batch whose signed batch_id differs from its file name", async () => {
    const fileIntake = new FakeFileIntake();
    const processingQueue = new FakeProcessingQueue({
        status: "enqueued",
        jobId: CLAIMED_FILE.batchId,
    });

    const service = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader: new FakeReader(),
        verifier: new FakeVerifier(
            createVerifiedBatch({
                batch_id: "8baf7e36-5c37-402f-930c-02c5b1dd8f04",
            }),
        ),
        processingQueue,
    });

    const result = await service.execute(CLAIMED_FILE);

    assert.deepEqual(result, {
        status: "quarantined",
        reason: "BATCH_ID_MISMATCH",
    });
    assert.equal(processingQueue.jobs.length, 0);
});

test("quarantines a batch whose signed collector_id differs from its source directory", async () => {
    const fileIntake = new FakeFileIntake();
    const processingQueue = new FakeProcessingQueue({
        status: "enqueued",
        jobId: CLAIMED_FILE.batchId,
    });

    const service = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader: new FakeReader(),
        verifier: new FakeVerifier(
            createVerifiedBatch({
                collector_id: "collector-other-01",
            }),
        ),
        processingQueue,
    });

    const result = await service.execute(CLAIMED_FILE);

    assert.deepEqual(result, {
        status: "quarantined",
        reason: "SOURCE_IDENTITY_MISMATCH",
    });
    assert.equal(processingQueue.jobs.length, 0);
    assert.equal(fileIntake.quarantined.length, 1);
    assert.equal(fileIntake.quarantined[0]?.reason, "SOURCE_IDENTITY_MISMATCH");
});

test("rethrows a Redis failure so the claimed file can be retried", async () => {
    const fileIntake = new FakeFileIntake();

    const service = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader: new FakeReader(),
        verifier: new FakeVerifier(createVerifiedBatch()),
        processingQueue: new FakeProcessingQueue(new Error("Redis is unavailable.")),
    });

    await assert.rejects(() => service.execute(CLAIMED_FILE), /Redis is unavailable/u);

    assert.equal(fileIntake.quarantined.length, 0);
});
