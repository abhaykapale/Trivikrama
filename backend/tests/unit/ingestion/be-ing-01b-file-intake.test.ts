import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    CollectorFileIntakeService,
    MAX_COLLECTOR_BATCH_BYTES,
} from "../../../src/modules/ingestion/index.js";

const COLLECTOR_ID = "collector-dev-01";
const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";

test("claims a final ARCH-01 batch atomically into the backend processing directory", async (context) => {
    const fixture = await createFixture(context);
    const publishedPath = join(
        fixture.incomingCollectorDirectory,
        `batch_${BATCH_ID}.json`,
    );

    await writeFile(publishedPath, '{"contract_version":"1.0.0"}', "utf8");

    const report = await fixture.intake.claimPublishedBatches();

    assert.equal(report.claimed.length, 1);
    assert.equal(report.quarantined.length, 0);
    assert.equal(report.ignored.length, 0);

    const [claimed] = report.claimed;

    assert.equal(claimed.collectorId, COLLECTOR_ID);
    assert.equal(claimed.batchId, BATCH_ID);
    assert.equal(claimed.originalFileName, `batch_${BATCH_ID}.json`);
    assert.match(claimed.processingFileName, /^batch_[0-9a-f-]+__collector_[A-Za-z0-9_-]+__claim_[0-9a-f-]+\.json$/u);
    assert.equal(await readFile(claimed.processingPath, "utf8"), '{"contract_version":"1.0.0"}');

    await assert.rejects(readFile(publishedPath));
});

test("ignores temporary, malformed, and symlink candidates without following them", async (context) => {
    const fixture = await createFixture(context);
    const validName = `batch_${BATCH_ID}.json`;

    await writeFile(join(fixture.incomingCollectorDirectory, `${validName}.tmp`), "temporary");
    await writeFile(join(fixture.incomingCollectorDirectory, "notes.txt"), "not a batch");
    await writeFile(join(fixture.root, "outside.json"), "outside");

    try {
        await symlink(
            join(fixture.root, "outside.json"),
            join(fixture.incomingCollectorDirectory, validName),
        );
    } catch (error) {
        if (!isUnsupportedSymlinkError(error)) {
            throw error;
        }
    }

    const report = await fixture.intake.claimPublishedBatches();

    assert.equal(report.claimed.length, 0);
    assert.equal(report.quarantined.length, 0);
    assert.ok(report.ignored.some((item) => item.reason === "TEMPORARY_OR_UNRECOGNIZED_FILE"));

    if (report.ignored.some((item) => item.reason === "SYMLINK_NOT_ALLOWED")) {
        assert.ok(report.ignored.some((item) => item.relativePath.endsWith(validName)));
    }
});

test("quarantines an oversized batch before it is read or parsed", async (context) => {
    const fixture = await createFixture(context);
    const publishedPath = join(
        fixture.incomingCollectorDirectory,
        `batch_${BATCH_ID}.json`,
    );

    await writeFile(publishedPath, Buffer.alloc(MAX_COLLECTOR_BATCH_BYTES + 1));

    const report = await fixture.intake.claimPublishedBatches();

    assert.equal(report.claimed.length, 0);
    assert.equal(report.quarantined.length, 1);
    assert.equal(report.quarantined[0].quarantineReason, "FILE_TOO_LARGE");
    assert.equal((await readFile(report.quarantined[0].quarantinePath)).byteLength, MAX_COLLECTOR_BATCH_BYTES + 1);
});

test("recovers a prior claim after restart", async (context) => {
    const fixture = await createFixture(context);
    const publishedPath = join(
        fixture.incomingCollectorDirectory,
        `batch_${BATCH_ID}.json`,
    );

    await writeFile(publishedPath, "signed bytes");
    const claimReport = await fixture.intake.claimPublishedBatches();
    const [claimed] = claimReport.claimed;

    const restartedIntake = new CollectorFileIntakeService({ handoffRoot: fixture.root });
    const recovery = await restartedIntake.recoverClaimedBatches();

    assert.equal(recovery.recovered.length, 1);
    assert.equal(recovery.recovered[0].processingPath, claimed.processingPath);
    assert.equal(recovery.recovered[0].claimedAt, null);
    assert.equal(recovery.quarantined.length, 0);
});

async function createFixture(context: test.TestContext): Promise<{
    readonly root: string;
    readonly incomingCollectorDirectory: string;
    readonly intake: CollectorFileIntakeService;
}> {
    const root = await mkdtemp(join(tmpdir(), "trivikrama-be-ing-01b-"));
    const incomingCollectorDirectory = join(root, "incoming", COLLECTOR_ID);

    await mkdir(incomingCollectorDirectory, { recursive: true });

    context.after(async () => {
        await rm(root, { recursive: true, force: true });
    });

    return {
        root,
        incomingCollectorDirectory,
        intake: new CollectorFileIntakeService({ handoffRoot: root }),
    };
}

function isUnsupportedSymlinkError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES" || error.code === "UNKNOWN")
    );
}
