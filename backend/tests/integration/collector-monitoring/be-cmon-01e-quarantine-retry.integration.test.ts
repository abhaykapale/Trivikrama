import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { QuarantineRetryError } from "../../../src/modules/collector-monitoring/domain/quarantine-retry.errors.js";
import { FilesystemQuarantineFileRequeuer } from "../../../src/modules/collector-monitoring/infrastructure/filesystem-quarantine-file.requeuer.js";

const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";
const CLAIM_ID = "f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d";
const COLLECTOR_ID = "collector-dev-01";

test("restores a quarantine file to incoming without changing its bytes", async () => {
  const fixture = await createFixture();

  try {
    const payload = '{"event_count":1,"events":[{"message":"safe"}]}';
    await writeFile(fixture.quarantinePath, payload);

    const result = await fixture.requeuer.requeue(fixture.filename);

    assert.deepEqual(result, {
      filename: fixture.filename,
      incomingRelativePath: `incoming/${COLLECTOR_ID}/batch_${BATCH_ID}.json`,
    });
    assert.equal(await readFile(fixture.destinationPath, "utf8"), payload);
    await assert.rejects(lstat(fixture.quarantinePath), hasCode("ENOENT"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("never overwrites an existing incoming batch", async () => {
  const fixture = await createFixture();

  try {
    await mkdir(fixture.collectorDirectory);
    await writeFile(fixture.quarantinePath, "quarantined-content");
    await writeFile(fixture.destinationPath, "existing-content");

    await assert.rejects(
      fixture.requeuer.requeue(fixture.filename),
      isRetryError("REQUEUE_DESTINATION_EXISTS"),
    );
    assert.equal(await readFile(fixture.destinationPath, "utf8"), "existing-content");
    assert.equal(await readFile(fixture.quarantinePath, "utf8"), "quarantined-content");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects invalid filenames and missing files", async () => {
  const fixture = await createFixture();

  try {
    await assert.rejects(
      fixture.requeuer.requeue("../outside.json"),
      isRetryError("INVALID_FILENAME"),
    );
    await assert.rejects(
      fixture.requeuer.requeue("manual.json"),
      isRetryError("INVALID_FILENAME"),
    );
    await assert.rejects(
      fixture.requeuer.requeue(fixture.filename),
      isRetryError("QUARANTINE_FILE_NOT_FOUND"),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses a symbolic-link quarantine entry", async (context) => {
  const fixture = await createFixture();
  const outside = join(fixture.root, "outside.json");

  try {
    await writeFile(outside, "outside-content");

    try {
      await symlink(outside, fixture.quarantinePath, "file");
    } catch (error: unknown) {
      if (isLinkPermissionError(error)) {
        context.skip("This platform does not permit creating test links.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      fixture.requeuer.requeue(fixture.filename),
      isRetryError("UNSAFE_HANDOFF_PATH"),
    );
    assert.equal(await readFile(outside, "utf8"), "outside-content");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "trivikrama-cmon-01e-"));
  const incoming = join(root, "incoming");
  const quarantine = join(root, "quarantine");
  const collectorDirectory = join(incoming, COLLECTOR_ID);
  const filename = quarantineName("schema_validation_failed");
  await mkdir(incoming);
  await mkdir(quarantine);

  return {
    root,
    filename,
    collectorDirectory,
    quarantinePath: join(quarantine, filename),
    destinationPath: join(collectorDirectory, `batch_${BATCH_ID}.json`),
    requeuer: new FilesystemQuarantineFileRequeuer({ handoffRoot: root }),
  };
}

function quarantineName(reason: string): string {
  const collector = Buffer.from(COLLECTOR_ID, "utf8").toString("base64url");
  return `batch_${BATCH_ID}__collector_${collector}__claim_${CLAIM_ID}__${reason}__${randomUUID()}.json`;
}

function isRetryError(code: QuarantineRetryError["code"]) {
  return (error: unknown): boolean =>
    error instanceof QuarantineRetryError && error.code === code;
}

function hasCode(code: string) {
  return (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function isLinkPermissionError(error: unknown): boolean {
  return hasCode("EPERM")(error) || hasCode("EACCES")(error);
}
