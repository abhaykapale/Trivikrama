import assert from "node:assert/strict";
import test from "node:test";

import { RunCollectorIntakeCycleService } from "../../../src/modules/ingestion/application/run-collector-intake-cycle.service.js";
import type {
    IClaimedCollectorBatchProcessor,
    VerifyAndQueueClaimedBatchResult,
} from "../../../src/modules/ingestion/application/verify-and-queue-claimed-batch.service.js";
import type {
    ClaimedCollectorBatchFile,
    CollectorBatchQuarantineReason,
    CollectorFileIntakeReport,
    CollectorFileRecoveryReport,
    ICollectorFileIntake,
    QuarantinedCollectorBatchFile,
} from "../../../src/modules/ingestion/domain/collector-file-intake.contracts.js";
import { CollectorProcessingJob } from "../../../src/modules/ingestion/index.js";

function createClaimedFile(batchId: string): ClaimedCollectorBatchFile {
    return {
        collectorId: "collector-dev-01",
        batchId,
        claimId: "f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d",
        originalFileName: `batch_${batchId}.json`,
        processingFileName: `batch_${batchId}.json`,
        processingPath: `/collector/processing/batch_${batchId}.json`,
        byteLength: 100,
        claimedAt: "2026-09-05T12:00:00.000Z",
    };
}

class FakeFileIntake implements ICollectorFileIntake {
    public readonly calls: string[] = [];

    public constructor(
        private readonly recovery: CollectorFileRecoveryReport,
        private readonly discovery: CollectorFileIntakeReport,
    ) {}

    public async initialize(): Promise<void> {
        this.calls.push("initialize");
    }

    public async recoverClaimedBatches(): Promise<CollectorFileRecoveryReport> {
        this.calls.push("recover");

        return this.recovery;
    }

    public async claimPublishedBatches(): Promise<CollectorFileIntakeReport> {
        this.calls.push("claim");

        return this.discovery;
    }

    public async quarantineProcessingJob(
        _job: CollectorProcessingJob,
        _reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile> {
        throw new Error("quarantineProcessingJob is not used by this BE-ING-01C test.");
    }

    public async quarantineClaimedBatch(
        claimedFile: ClaimedCollectorBatchFile,
        reason: QuarantinedCollectorBatchFile["quarantineReason"],
    ): Promise<QuarantinedCollectorBatchFile> {
        return {
            ...claimedFile,
            quarantineFileName: `quarantined_${claimedFile.batchId}.json`,
            quarantinePath: `/collector/quarantine/${claimedFile.batchId}.json`,
            quarantineReason: reason,
            quarantinedAt: "2026-09-05T12:00:00.000Z",
        };
    }
}

class FakeClaimedBatchProcessor implements IClaimedCollectorBatchProcessor {
    public readonly processedBatchIds: string[] = [];

    public constructor(
        private readonly outcomes: Map<string, VerifyAndQueueClaimedBatchResult | Error>,
    ) {}

    public async execute(
        claimedFile: ClaimedCollectorBatchFile,
    ): Promise<VerifyAndQueueClaimedBatchResult> {
        this.processedBatchIds.push(claimedFile.batchId);

        const outcome = this.outcomes.get(claimedFile.batchId);

        if (outcome instanceof Error) {
            throw outcome;
        }

        if (outcome === undefined) {
            throw new Error("Missing fake processor outcome.");
        }

        return outcome;
    }
}

test("recovers claimed batches before claiming and processing new batches", async () => {
    const recoveredFile = createClaimedFile("77d8092b-6bd8-4acd-ab16-bd56707a1377");
    const newlyClaimedFile = createClaimedFile("8baf7e36-5c37-402f-930c-02c5b1dd8f04");

    const fileIntake = new FakeFileIntake(
        {
            recovered: [recoveredFile],
            quarantined: [],
            ignored: [],
        },
        {
            claimed: [newlyClaimedFile],
            quarantined: [],
            ignored: [],
        },
    );

    const processor = new FakeClaimedBatchProcessor(
        new Map([
            [
                recoveredFile.batchId,
                {
                    status: "enqueued",
                    jobId: recoveredFile.batchId,
                },
            ],
            [
                newlyClaimedFile.batchId,
                {
                    status: "enqueued",
                    jobId: newlyClaimedFile.batchId,
                },
            ],
        ]),
    );

    const service = new RunCollectorIntakeCycleService({
        fileIntake,
        claimedBatchProcessor: processor,
    });

    const report = await service.execute();

    assert.deepEqual(fileIntake.calls, ["initialize", "recover", "claim"]);
    assert.deepEqual(processor.processedBatchIds, [
        recoveredFile.batchId,
        newlyClaimedFile.batchId,
    ]);
       assert.equal(report.processed.length, 2);

       assert.deepEqual(
           report.processed.map((outcome) =>
               "result" in outcome ? outcome.result.status : outcome.status,
           ),
           ["enqueued", "enqueued"],
       );
});

test("continues processing other files after one retryable failure", async () => {
    const failedFile = createClaimedFile("77d8092b-6bd8-4acd-ab16-bd56707a1377");
    const successfulFile = createClaimedFile("8baf7e36-5c37-402f-930c-02c5b1dd8f04");

    const fileIntake = new FakeFileIntake(
        {
            recovered: [],
            quarantined: [],
            ignored: [],
        },
        {
            claimed: [failedFile, successfulFile],
            quarantined: [],
            ignored: [],
        },
    );

        const outcomes = new Map<string, VerifyAndQueueClaimedBatchResult | Error>();

        outcomes.set(failedFile.batchId, new Error("Redis is unavailable."));

        outcomes.set(successfulFile.batchId, {
            status: "enqueued",
            jobId: successfulFile.batchId,
        });

        const processor = new FakeClaimedBatchProcessor(outcomes);

    const service = new RunCollectorIntakeCycleService({
        fileIntake,
        claimedBatchProcessor: processor,
    });

    const report = await service.execute();

    assert.deepEqual(processor.processedBatchIds, [failedFile.batchId, successfulFile.batchId]);
    assert.deepEqual(report.processed[0], {
        claimedFile: failedFile,
        status: "retryable_failure",
        errorName: "Error",
    });
    assert.deepEqual(report.processed[1], {
        claimedFile: successfulFile,
        result: {
            status: "enqueued",
            jobId: successfulFile.batchId,
        },
    });
});
