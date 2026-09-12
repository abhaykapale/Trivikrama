import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { BullMqProcessingQueueMonitor } from "../../../src/modules/collector-monitoring/infrastructure/bullmq-processing-queue.monitor.js";
import { FilesystemQuarantineMonitor } from "../../../src/modules/collector-monitoring/infrastructure/filesystem-quarantine.monitor.js";

test("reports live BullMQ and quarantine state", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-CMON-01B integration tests refuse to run in production.");
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const queueName = `be-cmon-01b-${randomUUID()}`;
  const prefix = "trivikrama-be-cmon-01b-test";
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
  connection.on("error", () => undefined);
  const queue = new Queue(queueName, { connection, prefix });
  const queueMonitor = new BullMqProcessingQueueMonitor({
    redisUrl,
    queueName,
    prefix,
  });
  const handoffRoot = await mkdtemp(join(tmpdir(), "trivikrama-cmon-01b-"));

  try {
    await queue.add("test-job", { sequence: 1 });
    await queue.add("test-job", { sequence: 2 });
    await mkdir(join(handoffRoot, "quarantine"));
    await writeFile(join(handoffRoot, "quarantine", "failed-one.json"), "{}");
    await writeFile(join(handoffRoot, "quarantine", "failed-two.json"), "{}");

    const [queueStatus, quarantineStatus] = await Promise.all([
      queueMonitor.getStatus(),
      new FilesystemQuarantineMonitor({ handoffRoot }).getStatus(),
    ]);

    assert.equal(queueStatus.name, queueName);
    assert.equal(queueStatus.waiting, 2);
    assert.equal(queueStatus.active, 0);
    assert.equal(queueStatus.failed, 0);
    assert.equal(queueStatus.isPaused, false);
    assert.deepEqual(quarantineStatus, { count: 2 });
  } finally {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    connection.disconnect();
    await queueMonitor.close().catch(() => undefined);
    await rm(handoffRoot, { recursive: true, force: true });
  }
});
