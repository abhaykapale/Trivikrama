import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemQuarantineFileCatalog } from "../../../src/modules/collector-monitoring/infrastructure/filesystem-quarantine-file.catalog.js";

const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";
const CLAIM_ID = "f694a7a4-91da-4aa2-9bfd-86e3b6ca1a1d";
const COLLECTOR_ID = "collector-dev-01";

test("lists safe backend-created quarantine metadata with pagination", async () => {
  const root = await mkdtemp(join(tmpdir(), "trivikrama-cmon-01d-"));
  const quarantine = join(root, "quarantine");
  await mkdir(quarantine);

  try {
    const first = quarantineName("schema_validation_failed");
    const second = quarantineName("empty_file");
    await writeFile(join(quarantine, first), JSON.stringify({ event_count: 50 }));
    await writeFile(join(quarantine, second), "not-json");
    await writeFile(join(quarantine, "manually-added.json"), '{"event_count":999}');
    await mkdir(join(quarantine, `nested_${randomUUID()}.json`));

    try {
      await symlink(
        join(quarantine, first),
        join(quarantine, quarantineName("linked_file")),
        "file",
      );
    } catch (error: unknown) {
      if (!isLinkPermissionError(error)) {
        throw error;
      }
    }

    const catalog = new FilesystemQuarantineFileCatalog({ handoffRoot: root });
    const result = await catalog.list({ offset: 0, limit: 1 });

    assert.equal(result.total, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.collectorId, COLLECTOR_ID);
    assert.equal(result.items[0]?.batchId, BATCH_ID);
    assert.equal(result.items[0]?.fileName.endsWith(".json"), true);
    assert.equal(Number.isFinite(result.items[0]?.fileSizeBytes), true);
    assert.equal(result.items[0]?.quarantinedAt instanceof Date, true);

    const all = await catalog.list({ offset: 0, limit: 25 });
    assert.deepEqual(
      new Set(all.items.map((item) => item.reason)),
      new Set(["SCHEMA_VALIDATION_FAILED", "EMPTY_FILE"]),
    );
    assert.deepEqual(
      new Set(all.items.map((item) => item.eventCount)),
      new Set([50, 0]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns an empty page before the handoff layout exists", async () => {
  const catalog = new FilesystemQuarantineFileCatalog({
    handoffRoot: join(tmpdir(), `missing-cmon-01d-${randomUUID()}`),
  });

  assert.deepEqual(await catalog.list({ offset: 0, limit: 25 }), {
    items: [],
    total: 0,
  });
});

test("refuses a symbolic-link handoff root", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "trivikrama-cmon-01d-link-"));
  const realRoot = join(parent, "real");
  const linkedRoot = join(parent, "linked");
  await mkdir(realRoot);

  try {
    try {
      await symlink(
        realRoot,
        linkedRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error: unknown) {
      if (isLinkPermissionError(error)) {
        context.skip("This platform does not permit creating test links.");
        return;
      }

      throw error;
    }

    await assert.rejects(
      new FilesystemQuarantineFileCatalog({ handoffRoot: linkedRoot }).list({
        offset: 0,
        limit: 25,
      }),
      /refuses symbolic-link directories/u,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

function quarantineName(reason: string): string {
  const collector = Buffer.from(COLLECTOR_ID, "utf8").toString("base64url");

  return `batch_${BATCH_ID}__collector_${collector}__claim_${CLAIM_ID}__${reason}__${randomUUID()}.json`;
}

function isLinkPermissionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES")
  );
}
