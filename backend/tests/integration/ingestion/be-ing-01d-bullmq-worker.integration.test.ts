import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { ProcessCollectorProcessingJobResult } from "../../../src/modules/ingestion/application/process-collector-processing-job.service.js";
import type { CollectorProcessingJob } from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";
import { BullMqCollectorProcessingWorker } from "../../../src/modules/ingestion/infrastructure/bullmq-collector-processing.worker.js";
import { BullMqProcessingQueue } from "../../../src/modules/ingestion/infrastructure/bullmq-processing.queue.js";

const TEST_JOB: CollectorProcessingJob = {
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    collectorId: "collector-dev-01",
    processingFileName:
        "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_6cf46da8-57d6-49e6-b6f8-9d5d1b5ec6dc.json",
    canonicalUnsignedSha256:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    enqueuedAt: "2026-09-07T00:00:00.000Z",
    byteLength: 512,
};

test("BullMQ worker receives and completes a Collector processing job", async (context) => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const queueName = `collector-processing-worker-test-${randomUUID()}`;
    const prefix = `trivikrama-worker-test-${randomUUID()}`;

    const handler = new RecordingJobHandler();

    const worker = new BullMqCollectorProcessingWorker(
        {
            redisUrl,
            queueName,
            prefix,
        },
        {
            jobHandler: handler,
        },
    );

    const queue = new BullMqProcessingQueue({
        redisUrl,
        queueName,
        prefix,
    });

    context.after(async () => {
        await worker.close();
        await queue.close();
    });

    await worker.waitUntilReady();

    await queue.enqueue(TEST_JOB);

    const receivedJob = await waitForJob(handler.receivedJob, 5_000);

    assert.deepEqual(receivedJob, TEST_JOB);
    assert.deepEqual(handler.jobs, [TEST_JOB]);
});

class RecordingJobHandler {


    public readonly jobs: CollectorProcessingJob[] = [];

    public readonly receivedJob: Promise<CollectorProcessingJob>;

    private  resolveReceivedJob!: (job: CollectorProcessingJob) => void;

    public constructor() {
        this.receivedJob = new Promise<CollectorProcessingJob>((resolve) => {
            this.resolveReceivedJob = resolve;
        });
    }

    public async execute(
        job: CollectorProcessingJob,
    ): Promise<ProcessCollectorProcessingJobResult> {
        this.jobs.push(job);
        this.resolveReceivedJob(job);

        return {
            status: "processed",
            archiveStatus: "archived",
            totalEvents: 1,
            insertedEvents: 1,
            alreadyPresentEvents: 0,
            generatedAlerts: 0,
            insertedAlerts: 0,
            alreadyPresentAlerts: 0,
        };
    }
}

async function waitForJob(
    jobPromise: Promise<CollectorProcessingJob>,
    timeoutMs: number,
): Promise<CollectorProcessingJob> {
    let timeout: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            jobPromise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(
                        new Error(`BullMQ worker did not receive the job within ${timeoutMs} ms.`),
                    );
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}
