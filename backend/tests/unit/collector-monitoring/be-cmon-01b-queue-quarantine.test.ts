import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FilesystemQuarantineMonitor } from "../../../src/modules/collector-monitoring/infrastructure/filesystem-quarantine.monitor.js";

test("counts only regular JSON quarantine files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "trivikrama-cmon-quarantine-"));
  const quarantine = join(root, "quarantine");
  await mkdir(quarantine);
  await writeFile(join(quarantine, "batch-one.json"), "{}");
  await writeFile(join(quarantine, "BATCH-TWO.JSON"), "{}");
  await writeFile(join(quarantine, "notes.txt"), "ignore");
  await mkdir(join(quarantine, "nested.json"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });

  const result = await new FilesystemQuarantineMonitor({
    handoffRoot: root,
  }).getStatus();

  assert.deepEqual(result, { count: 2 });
});

test("returns zero before the handoff layout exists", async () => {
  const monitor = new FilesystemQuarantineMonitor({
    handoffRoot: join(tmpdir(), `missing-cmon-root-${Date.now()}`),
  });

  assert.deepEqual(await monitor.getStatus(), { count: 0 });
});

test("refuses a symbolic-link handoff root", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "trivikrama-cmon-link-"));
  const realRoot = join(parent, "real");
  const linkedRoot = join(parent, "linked");
  await mkdir(realRoot);
  try {
    await symlink(
      realRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      context.skip("This platform does not permit creating test links.");
      return;
    }

    throw error;
  }
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(parent, { recursive: true, force: true });
  });

  await assert.rejects(
    new FilesystemQuarantineMonitor({ handoffRoot: linkedRoot }).getStatus(),
    /refuses symbolic-link directories/u,
  );
});

test("validates the configured handoff root", () => {
  assert.throws(
    () => new FilesystemQuarantineMonitor({ handoffRoot: "   " }),
    /handoff root is required/u,
  );
});
