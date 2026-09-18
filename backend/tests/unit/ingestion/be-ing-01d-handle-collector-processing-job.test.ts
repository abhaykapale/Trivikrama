import assert from "node:assert/strict";
import test from "node:test";

import { HandleCollectorProcessingJobService } from "../../../src/modules/ingestion/application/handle-collector-processing-job.service.js";
import type { ProcessCollectorProcessingJobResult } from "../../../src/modules/ingestion/application/process-collector-processing-job.service.js";
import type {
    CollectorBatchQuarantineReason,
    QuarantinedCollectorBatchFile,
} from "../../../src/modules/ingestion/domain/collector-file-intake.contracts.js";
import type { Sha256Digest } from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";
import type { CollectorProcessingJob } from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";

const DIGEST: Sha256Digest =
    "sha256:4b29c5fe8d21b07c0f079e0fe89ebbbce9cd4eea5cc463f3673ef787e9dbf86c";

const JOB: CollectorProcessingJob = {
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    collectorId: "collector-dev-01",
    processingFileName:
        "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_e3f25231-fe99-4458-84bb-c181fe73b1f4.json",
    byteLength: 2048,
    canonicalUnsignedSha256: DIGEST,
    enqueuedAt: "2026-09-07T00:00:00.000Z",
};

test("finalizes a successfully processed job without quarantining its file", async () => {
    const processor = new FakeProcessor({
        status: "processed",
        archiveStatus: "archived",
        totalEvents: 1,
        insertedEvents: 1,
        alreadyPresentEvents: 0,
        generatedAlerts: 0,
        insertedAlerts: 0,
        alreadyPresentAlerts: 0,
    });
    const fileIntake = new FakeFileIntake();

    const service = new HandleCollectorProcessingJobService({
        processor,
        fileIntake,
    });

    const result = await service.execute(JOB);

    assert.deepEqual(result, {
        status: "processed",
        archiveStatus: "archived",
        totalEvents: 1,
        insertedEvents: 1,
        alreadyPresentEvents: 0,
        generatedAlerts: 0,
        insertedAlerts: 0,
        alreadyPresentAlerts: 0,
    });
    assert.deepEqual(processor.jobs, [JOB]);
    assert.deepEqual(fileIntake.calls, []);
    assert.deepEqual(fileIntake.completedJobs, [JOB]);
});

test("quarantines the file when the processor reports an integrity failure", async () => {
    const processor = new FakeProcessor({
        status: "quarantine",
        reason: "BATCH_DIGEST_MISMATCH",
    });
    const fileIntake = new FakeFileIntake();

    const service = new HandleCollectorProcessingJobService({
        processor,
        fileIntake,
    });

    const result = await service.execute(JOB);

    assert.deepEqual(result, {
        status: "quarantine",
        reason: "BATCH_DIGEST_MISMATCH",
    });

    assert.deepEqual(fileIntake.calls, [
        {
            job: JOB,
            reason: "BATCH_DIGEST_MISMATCH",
        },
    ]);
});

test("rethrows an infrastructure failure so BullMQ can retry the job", async () => {
    const expectedError = new Error("MongoDB is temporarily unavailable.");
    const processor = new FakeProcessor(expectedError);
    const fileIntake = new FakeFileIntake();

    const service = new HandleCollectorProcessingJobService({
        processor,
        fileIntake,
    });

    await assert.rejects(service.execute(JOB), expectedError);

    assert.deepEqual(fileIntake.calls, []);
});

test("rethrows a completion failure so BullMQ can retry after persistence", async () => {
    const processor = new FakeProcessor({
        status: "processed",
        archiveStatus: "archived",
        totalEvents: 1,
        insertedEvents: 1,
        alreadyPresentEvents: 0,
        generatedAlerts: 0,
        insertedAlerts: 0,
        alreadyPresentAlerts: 0,
    });
    const expectedError = new Error("processed directory is temporarily unavailable");
    const fileIntake = new FakeFileIntake(expectedError);
    const service = new HandleCollectorProcessingJobService({ processor, fileIntake });

    await assert.rejects(service.execute(JOB), expectedError);
    assert.deepEqual(fileIntake.calls, []);
    assert.deepEqual(fileIntake.completedJobs, [JOB]);
});

class FakeProcessor {
    public readonly jobs: CollectorProcessingJob[] = [];

    public constructor(private readonly outcome: ProcessCollectorProcessingJobResult | Error) {}

    public async execute(
        job: CollectorProcessingJob,
    ): Promise<ProcessCollectorProcessingJobResult> {
        this.jobs.push(job);

        if (this.outcome instanceof Error) {
            throw this.outcome;
        }

        return this.outcome;
    }
}

class FakeFileIntake {
    public readonly calls: Array<{
        readonly job: CollectorProcessingJob;
        readonly reason: CollectorBatchQuarantineReason;
    }> = [];
    public readonly completedJobs: CollectorProcessingJob[] = [];

    public constructor(private readonly completionError?: Error) {}

    public async quarantineProcessingJob(
        job: CollectorProcessingJob,
        reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile> {
        this.calls.push({ job, reason });

        return {
            collectorId: job.collectorId,
            batchId: job.batchId,
            claimId: "e3f25231-fe99-4458-84bb-c181fe73b1f4",
            originalFileName: `batch_${job.batchId}.json`,
            processingFileName: job.processingFileName,
            processingPath: `/processing/${job.processingFileName}`,
            byteLength: job.byteLength,
            claimedAt: null,
            quarantineFileName: `quarantined-${job.processingFileName}`,
            quarantinePath: `/quarantine/${job.processingFileName}`,
            quarantineReason: reason,
            quarantinedAt: "2026-09-07T00:00:00.000Z",
        };
    }

    public async completeProcessingJob(job: CollectorProcessingJob) {
        this.completedJobs.push(job);

        if (this.completionError !== undefined) {
            throw this.completionError;
        }

        return {
            status: "completed" as const,
            processedPath: `/processed/${job.processingFileName}`,
        };
    }
}
