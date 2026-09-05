// Integration tests for the BullMQ processing queue
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BullMqProcessingQueue } from "../../../src/modules/ingestion/infrastructure/bullmq-processing.queue.js";

const TEST_JOB = {
    batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
    collectorId: "collector-dev-01",
    processingFileName:
        "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_6cf46da8-57d6-49e6-b6f8-9d5d1b5ec6dc.json",
    canonicalUnsignedSha256:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    enqueuedAt: "2026-09-04T12:00:00.000Z",
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
