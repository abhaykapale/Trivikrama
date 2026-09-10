import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { CollectorHeartbeatFileReader } from "../../../src/modules/ingestion/infrastructure/collector-heartbeat-file.reader.js";
import { CollectorHeartbeatError } from "../../../src/modules/ingestion/domain/collector-heartbeat.errors.js";

const COLLECTOR_ID = "collector-dev-01";

test("reads an identity-scoped heartbeat snapshot without moving it", async (context) => {
    const root = await createRoot(context);
    const collectorDirectory = join(root, "incoming", COLLECTOR_ID);
    const heartbeatPath = join(collectorDirectory, "heartbeat.json");
    const payload = new TextEncoder().encode('{"message_type":"heartbeat"}');

    await mkdir(collectorDirectory, { recursive: true });
    await writeFile(heartbeatPath, payload);

    const reader = new CollectorHeartbeatFileReader({ handoffRoot: root, collectorId: COLLECTOR_ID });
    const snapshot = await reader.read();

    assert.notEqual(snapshot, null);
    assert.equal(snapshot?.collectorId, COLLECTOR_ID);
    assert.equal(snapshot?.filePath, heartbeatPath);
    assert.deepEqual(snapshot?.contents, payload);
    assert.equal(snapshot?.byteLength, payload.byteLength);

    const replay = await reader.read();
    assert.deepEqual(replay?.contents, payload);
});

test("returns null before the Collector publishes a heartbeat", async (context) => {
    const root = await createRoot(context);
    const reader = new CollectorHeartbeatFileReader({ handoffRoot: root, collectorId: COLLECTOR_ID });

    assert.equal(await reader.read(), null);
});

test("rejects an oversized heartbeat before reading it", async (context) => {
    const root = await createRoot(context);
    const collectorDirectory = join(root, "incoming", COLLECTOR_ID);

    await mkdir(collectorDirectory, { recursive: true });
    await writeFile(join(collectorDirectory, "heartbeat.json"), new Uint8Array(33));

    const reader = new CollectorHeartbeatFileReader({
        handoffRoot: root,
        collectorId: COLLECTOR_ID,
        maxHeartbeatBytes: 32,
    });

    await assert.rejects(
        reader.read(),
        (error: unknown) =>
            error instanceof CollectorHeartbeatError && error.code === "HEARTBEAT_TOO_LARGE",
    );
});

test("rejects a non-regular heartbeat path", async (context) => {
    const root = await createRoot(context);
    const heartbeatPath = join(root, "incoming", COLLECTOR_ID, "heartbeat.json");

    await mkdir(heartbeatPath, { recursive: true });

    const reader = new CollectorHeartbeatFileReader({ handoffRoot: root, collectorId: COLLECTOR_ID });

    await assert.rejects(
        reader.read(),
        (error: unknown) =>
            error instanceof CollectorHeartbeatError && error.code === "HEARTBEAT_NOT_REGULAR",
    );
});

async function createRoot(context: TestContext): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "trivikrama-heartbeat-reader-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
