import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
    closePostgres,
    createPostgresClient,
    pingPostgres,
} from "../../../src/database/postgres/client.js";
import { PostgresCollectorStatusRepository } from "../../../src/database/repositories/collector-status/postgres-collector-status.repository.js";
import type { CollectorStatusRecord } from "../../../src/database/repositories/collector-status/collector-status.repository.js";

test("PostgreSQL applies newer heartbeats and marks stale Collectors offline", async (context) => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-ING-01F integration tests refuse to run in production.");
    }

    const collectorId = `be-ing-01f-${randomUUID()}`;
    const postgres = createPostgresClient({
        connectionString:
            process.env.DATABASE_URL ??
            "postgresql://trivikrama_app:Abhay@287@localhost:5432/trivikrama",
        poolMin: 0,
        poolMax: 2,
        acquireConnectionTimeoutMs: 5_000,
    });
    const repository = new PostgresCollectorStatusRepository(postgres);

    context.after(async () => {
        try {
            await postgres("monitor.collector_status").where("collector_id", collectorId).delete();
        } finally {
            await closePostgres(postgres);
        }
    });

    await pingPostgres(postgres);

    const firstHeartbeatAt = new Date("2026-09-09T11:59:00.000Z");
    const newerHeartbeatAt = new Date("2026-09-09T12:00:00.000Z");

    await repository.upsertHeartbeat({
        collectorId,
        status: "online",
        lastHeartbeatAt: firstHeartbeatAt,
        heartbeatData: { sequence: 1, started_at: "2026-09-09T11:00:00.000Z" },
        filesProcessed: 9,
        eventsCollected: 100,
        orgId: "be-ing-01f-integration",
    });

    const newer = await repository.upsertHeartbeat({
        collectorId,
        status: "degraded",
        lastHeartbeatAt: newerHeartbeatAt,
        heartbeatData: { sequence: 2, started_at: "2026-09-09T11:00:00.000Z" },
        eventsCollected: 120,
        eventsDropped: 2,
        errorsCount: 1,
        cpuPercent: 18.5,
        memoryMb: 256,
        orgId: "be-ing-01f-integration",
    });

    assert.equal(newer.status, "degraded");
    assert.equal(newer.filesProcessed, 9, "an omitted metric must retain its prior value");
    assert.equal(newer.eventsCollected, 120);

    const staleWrite = await repository.upsertHeartbeat({
        collectorId,
        status: "online",
        lastHeartbeatAt: new Date("2026-09-09T11:58:00.000Z"),
        heartbeatData: { sequence: 0 },
        eventsCollected: 1,
    });

    assert.equal(staleWrite.lastHeartbeatAt?.toISOString(), newerHeartbeatAt.toISOString());
    assert.equal(staleWrite.status, "degraded");
    assert.equal(staleWrite.eventsCollected, 120);

    const markedOffline = await repository.markStaleOffline(
        new Date("2026-09-09T12:01:31.000Z"),
        "be-ing-01f-integration",
    );
    const offline = await repository.findByCollectorId(collectorId);

    assert.equal(markedOffline, 1);
    assertCollectorDefined(offline);
    assert.equal(offline.status, "offline");
});

function assertCollectorDefined(
    value: CollectorStatusRecord | null,
): asserts value is CollectorStatusRecord {
    assert.notEqual(value, null);
}
