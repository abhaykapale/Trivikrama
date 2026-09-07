import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { RunCollectorIntakeCycleService } from "../../../src/modules/ingestion/application/run-collector-intake-cycle.service.js";
import { VerifyAndQueueClaimedBatchService } from "../../../src/modules/ingestion/application/verify-and-queue-claimed-batch.service.js";
import { createConfiguredCollectorMessageVerifier } from "../../../src/modules/ingestion/composition/configured-ingestion-verification.dependencies.js";
import { CollectorFileIntakeService } from "../../../src/modules/ingestion/infrastructure/collector-file-intake.service.js";
import { ClaimedCollectorBatchReader } from "../../../src/modules/ingestion/infrastructure/claimed-collector-batch.reader.js";
import { InMemoryProcessingQueue } from "../../../src/modules/ingestion/infrastructure/in-memory-processing.queue.js";

const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

const COLLECTOR_ID = "collector-dev-01";

const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";

const contractRoot = findContractRoot();

test("atomically publishes, verifies, claims, and queues an official Collector batch", async (context) => {
    const handoffRoot = await mkdtemp(join(tmpdir(), "trivikrama-ingestion-"));

    context.after(async () => {
        await rm(handoffRoot, {
            recursive: true,
            force: true,
        });
    });

    await publishOfficialFixture(handoffRoot);

    const fileIntake = new CollectorFileIntakeService({
        handoffRoot,
    });

    const reader = new ClaimedCollectorBatchReader({
        handoffRoot,
    });

    const verifier = createConfiguredCollectorMessageVerifier({
        collectorId: COLLECTOR_ID,
        keyId: "collector-key-test-01",
        secretBase64Url: TEST_SECRET,
    });

    const processingQueue = new InMemoryProcessingQueue();

    const claimedBatchProcessor = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader,
        verifier,
        processingQueue,
    });

    const intakeCycle = new RunCollectorIntakeCycleService({
        fileIntake,
        claimedBatchProcessor,
    });

    const firstCycle = await intakeCycle.execute();
    

    assert.equal(firstCycle.discovery.claimed.length, 1);
    assert.equal(firstCycle.processed.length, 1);

    const firstOutcome = firstCycle.processed[0];

    if (firstOutcome === undefined || !("result" in firstOutcome)) {
        throw new Error("Expected the published batch to produce a processing result.");
    }

    assert.deepEqual(firstOutcome.result, {
        status: "enqueued",
        jobId: BATCH_ID,
    });

    const processingFiles = await readdir(join(handoffRoot, "processing"));

    assert.equal(processingFiles.length, 1);

    const secondCycle = await intakeCycle.execute();

    assert.equal(secondCycle.recovery.recovered.length, 1);
    assert.equal(secondCycle.processed.length, 1);

    const secondOutcome = secondCycle.processed[0];

    if (secondOutcome === undefined || !("result" in secondOutcome)) {
        throw new Error("Expected the recovered batch to produce a processing result.");
    }

    assert.deepEqual(secondOutcome.result, {
        status: "already_exists",
        jobId: BATCH_ID,
    });
});

async function publishOfficialFixture(handoffRoot: string): Promise<void> {
    const collectorDirectory = join(handoffRoot, "incoming", COLLECTOR_ID);

    const finalFileName = `batch_${BATCH_ID}.json`;
    const temporaryPath = join(collectorDirectory, `${finalFileName}.tmp`);
    const finalPath = join(collectorDirectory, finalFileName);

    const fixtureBytes = readFileSync(
        join(contractRoot, "fixtures", "positive", "event-batch.json"),
    );

    await mkdir(collectorDirectory, {
        recursive: true,
    });

    await writeFile(temporaryPath, fixtureBytes);

    await rename(temporaryPath, finalPath);
}

function findContractRoot(): string {
    const candidates = [
        resolve(process.cwd(), "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
    ];

    for (const candidate of candidates) {
        if (existsSync(join(candidate, "fixtures", "positive", "event-batch.json"))) {
            return candidate;
        }
    }

    throw new Error("ARCH-01 Collector contract fixtures were not found.");
}
