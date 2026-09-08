import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Sha256Digest } from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";
import type { CollectorProcessingJob } from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";
import { ClaimedCollectorBatchReader } from "../../../src/modules/ingestion/infrastructure/claimed-collector-batch.reader.js";
import { CollectorFileIntakeService } from "../../../src/modules/ingestion/infrastructure/collector-file-intake.service.js";

const CONTENTS = new TextEncoder().encode("verified collector batch");
const JOB = createJob(CONTENTS.byteLength);

test("atomically completes a processing file and supports idempotent retry reads", async (context) => {
    const handoffRoot = await mkdtemp(join(tmpdir(), "trivikrama-complete-"));

    context.after(async () => {
        await rm(handoffRoot, { recursive: true, force: true });
    });

    const intake = new CollectorFileIntakeService({ handoffRoot });
    const reader = new ClaimedCollectorBatchReader({ handoffRoot });
    await intake.initialize();

    const processingPath = join(handoffRoot, "processing", JOB.processingFileName);
    await writeFile(processingPath, CONTENTS);

    const first = await intake.completeProcessingJob(JOB);
    assert.equal(first.status, "completed");
    assert.equal(existsSync(processingPath), false);
    assert.equal(existsSync(first.processedPath), true);

    assert.deepEqual(await reader.read(JOB), CONTENTS);

    const replay = await intake.completeProcessingJob(JOB);
    assert.equal(replay.status, "already_completed");
    assert.equal(replay.processedPath, first.processedPath);
});

function createJob(byteLength: number): CollectorProcessingJob {
    return {
        batchId: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
        collectorId: "collector-dev-01",
        processingFileName:
            "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_e3f25231-fe99-4458-84bb-c181fe73b1f4.json",
        byteLength,
        canonicalUnsignedSha256:
            "sha256:4b29c5fe8d21b07c0f079e0fe89ebbbce9cd4eea5cc463f3673ef787e9dbf86c" as Sha256Digest,
        enqueuedAt: "2026-09-08T00:00:00.000Z",
    };
}

