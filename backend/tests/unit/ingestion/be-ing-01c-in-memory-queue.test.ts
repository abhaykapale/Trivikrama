import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryProcessingQueue } from "../../../src/modules/ingestion/infrastructure/in-memory-processing.queue.js";

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

test("InMemoryProcessingQueue enqueues a new batch using batchId as jobId", async () => {
    const queue = new InMemoryProcessingQueue();

    const result = await queue.enqueue(TEST_JOB);

    assert.deepEqual(result, {
        status: "enqueued",
        jobId: TEST_JOB.batchId,
    });
});

test("InMemoryProcessingQueue treats the same batchId as an idempotent retry", async () => {
    const queue = new InMemoryProcessingQueue();

    await queue.enqueue(TEST_JOB);
    const result = await queue.enqueue(TEST_JOB);

    assert.deepEqual(result, {
        status: "already_exists",
        jobId: TEST_JOB.batchId,
    });
});
