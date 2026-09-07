import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type { CollectorProcessingJob } from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";
import type { Sha256Digest } from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";
import { CollectorFileIntakeService } from "../../../src/modules/ingestion/infrastructure/collector-file-intake.service.js";

const COLLECTOR_ID = "collector-dev-01";
const OTHER_COLLECTOR_ID = "collector-dev-02";
const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";
const CLAIM_ID = "e3f25231-fe99-4458-84bb-c181fe73b1f4";

const DIGEST: Sha256Digest =
    "sha256:4b29c5fe8d21b07c0f079e0fe89ebbbce9cd4eea5cc463f3673ef787e9dbf86c";

test("quarantineProcessingJob moves a valid claimed batch into quarantine", async (context) => {
    const handoffRoot = await mkdtemp(join(tmpdir(), "trivikrama-quarantine-"));

    context.after(async () => {
        await rm(handoffRoot, { recursive: true, force: true });
    });

    const service = new CollectorFileIntakeService({ handoffRoot });
    await service.initialize();

    const job = createJob(COLLECTOR_ID);
    const processingPath = join(handoffRoot, "processing", job.processingFileName);

    await writeFile(processingPath, "signed collector batch");

    const result = await service.quarantineProcessingJob(job, "BATCH_DIGEST_MISMATCH");

    assert.equal(result.collectorId, COLLECTOR_ID);
    assert.equal(result.batchId, BATCH_ID);
    assert.equal(result.quarantineReason, "BATCH_DIGEST_MISMATCH");
    assert.equal(existsSync(processingPath), false);
    assert.equal(existsSync(result.quarantinePath), true);

    const processingFiles = await readdir(join(handoffRoot, "processing"));
    const quarantineFiles = await readdir(join(handoffRoot, "quarantine"));

    assert.deepEqual(processingFiles, []);
    assert.equal(quarantineFiles.length, 1);
});

test("quarantineProcessingJob rejects a job whose identity differs from its file name", async (context) => {
    const handoffRoot = await mkdtemp(join(tmpdir(), "trivikrama-quarantine-"));

    context.after(async () => {
        await rm(handoffRoot, { recursive: true, force: true });
    });

    const service = new CollectorFileIntakeService({ handoffRoot });
    await service.initialize();

    const realJob = createJob(COLLECTOR_ID);
    const processingPath = join(handoffRoot, "processing", realJob.processingFileName);

    await mkdir(join(handoffRoot, "processing"), { recursive: true });
    await writeFile(processingPath, "signed collector batch");

    const forgedJob = createJob(OTHER_COLLECTOR_ID, {
        processingFileName: realJob.processingFileName,
    });

    await assert.rejects(service.quarantineProcessingJob(forgedJob, "BATCH_DIGEST_MISMATCH"));

    assert.equal(existsSync(processingPath), true, "A forged job must not move the real file.");
});

function createJob(
    collectorId: string,
    overrides: Partial<CollectorProcessingJob> = {},
): CollectorProcessingJob {
    return {
        batchId: BATCH_ID,
        collectorId,
        processingFileName: createProcessingFileName(COLLECTOR_ID),
        byteLength: 22,
        canonicalUnsignedSha256: DIGEST,
        enqueuedAt: new Date().toISOString(),
        ...overrides,
    };
}

function createProcessingFileName(collectorId: string): string {
    const encodedCollectorId = Buffer.from(collectorId, "utf8").toString("base64url");

    return `batch_${BATCH_ID}__collector_${encodedCollectorId}__claim_${CLAIM_ID}.json`;
}
