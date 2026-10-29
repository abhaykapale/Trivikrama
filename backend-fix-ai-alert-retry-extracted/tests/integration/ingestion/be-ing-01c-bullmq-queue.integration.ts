// Integration tests for the BullMQ processing queue
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

import {
    BullMqProcessingQueue,
    PROCESS_COLLECTOR_BATCH_JOB_NAME,
} from "../../../src/modules/ingestion/infrastructure/bullmq-processing.queue.js";

const TEST_JOB = {
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    collectorId: "collector-dev-01",
    processingFileName:
        "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_6cf46da8-57d6-49e6-b6f8-9d5d1b5ec6dc.json",
    canonicalUnsignedSha256:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    enqueuedAt: "2026-09-04T12:00:00.000Z",
    byteLength: 512,
} as const;

test("BullMqProcessingQueue durably enqueues a batch once", async (context) => {
    const queue = new BullMqProcessingQueue({
        redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
        queueName: `collector-processing-test-${randomUUID()}`,
        prefix: `trivikrama-test-${randomUUID()}`,
    });

    context.after(async () => {
        await queue.close();
    });

    const firstResult = await queue.enqueue(TEST_JOB);
    const secondResult = await queue.enqueue(TEST_JOB);

    assert.deepEqual(firstResult, {
        status: "enqueued",
        jobId: TEST_JOB.batchId,
    });

    assert.deepEqual(secondResult, {
        status: "already_exists",
        jobId: TEST_JOB.batchId,
    });
});

test("BullMqProcessingQueue requeues a preserved failed batch", async (context) => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const queueName = `collector-processing-test-${randomUUID()}`;
    const prefix = `trivikrama-test-${randomUUID()}`;
    const queue = new BullMqProcessingQueue({ redisUrl, queueName, prefix });
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(
        queueName,
        async () => {
            throw new Error("expected first-attempt failure");
        },
        { connection, prefix },
    );
    const inspectionQueue = new Queue(queueName, { connection, prefix });
    let workerClosed = false;

    context.after(async () => {
        if (!workerClosed) await worker.close();
        await inspectionQueue.obliterate({ force: true });
        await inspectionQueue.close();
        await queue.close();
        connection.disconnect();
    });

    const failed = new Promise<void>((resolve) => {
        worker.once("failed", () => resolve());
    });
    await inspectionQueue.add(PROCESS_COLLECTOR_BATCH_JOB_NAME, TEST_JOB, {
        jobId: TEST_JOB.batchId,
        attempts: 1,
    });
    await failed;
    const job = await inspectionQueue.getJob(TEST_JOB.batchId);
    assert.ok(job);
    await worker.close();
    workerClosed = true;

    assert.equal(await job.getState(), "failed");
    assert.deepEqual(await queue.enqueue(TEST_JOB), {
        status: "enqueued",
        jobId: TEST_JOB.batchId,
    });
    assert.equal(await job.getState(), "waiting");
});
