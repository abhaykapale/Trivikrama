import assert from "node:assert/strict";
import test from "node:test";

import type {
  CollectorStatusRecord,
  ICollectorStatusRepository,
} from "../../../src/database/index.js";
import { GetCollectorStatusUseCase } from "../../../src/modules/collector-monitoring/application/get-collector-status.use-case.js";
import type { ICollectorMonitoringRepository } from "../../../src/modules/collector-monitoring/domain/collector-monitoring.contracts.js";
import { CollectorMonitoringRepositoryAdapter } from "../../../src/modules/collector-monitoring/infrastructure/collector-monitoring.repository.adapter.js";

test("maps only dashboard-safe Collector status fields", async () => {
  const repository: ICollectorMonitoringRepository = {
    async listByOrgId(orgId) {
      assert.equal(orgId, "org-alpha");
      return [createRecord()];
    },
  };
  const useCase = createUseCase(repository);

  const result = await useCase.execute({ orgId: " org-alpha " });

  assert.deepEqual(result, {
    collectors: [
      {
        collectorId: "collector-alpha",
        status: "degraded",
        lastHeartbeatAt: "2026-09-10T12:00:00.000Z",
        filesProcessed: 42,
        eventsCollected: 900,
        eventsDropped: 4,
        errorsCount: 2,
        cpuPercent: 17.5,
        memoryMb: 256,
        diskAvailableBytes: 4096,
        lastBatchId: "batch-42",
        firstSeenAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    queue: { ...QUEUE_STATUS, deadLettered: 3 },
    quarantine: { count: 3 },
    aiEngine: AI_ENGINE_STATUS,
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("canonical_unsigned_sha256"), false);
  assert.equal(serialized.includes("signature-must-not-leak"), false);
  assert.equal(serialized.includes("org-alpha"), false);
});

test("returns null for unavailable optional heartbeat metrics", async () => {
  const repository: ICollectorMonitoringRepository = {
    async listByOrgId() {
      return [
        {
          ...createRecord(),
          lastHeartbeatAt: null,
          heartbeatData: { metrics: { disk_available_bytes: -1, last_batch_id: " " } },
        },
      ];
    },
  };

  const result = await createUseCase(repository).execute({
    orgId: "org-alpha",
  });

  assert.equal(result.collectors[0]?.lastHeartbeatAt, null);
  assert.equal(result.collectors[0]?.diskAvailableBytes, null);
  assert.equal(result.collectors[0]?.lastBatchId, null);
});

test("rejects a blank organization boundary", async () => {
  const repository: ICollectorMonitoringRepository = {
    async listByOrgId() {
      throw new Error("Repository must not be called.");
    },
  };

  await assert.rejects(
    createUseCase(repository).execute({ orgId: "   " }),
    /orgId must not be blank/u,
  );
});

test("repository adapter retrieves every organization-scoped page", async () => {
  const calls: Array<{ orgId?: string; limit?: number; offset?: number }> = [];
  const first = createDatabaseRecord("collector-1");
  const second = createDatabaseRecord("collector-2");
  const repository: Pick<ICollectorStatusRepository, "list"> = {
    async list(filters = {}) {
      calls.push(filters);

      return filters.offset === 0
        ? { items: [first], limit: 100, offset: 0, hasMore: true }
        : { items: [second], limit: 100, offset: 1, hasMore: false };
    },
  };

  const result = await new CollectorMonitoringRepositoryAdapter(
    repository,
  ).listByOrgId("org-alpha");

  assert.deepEqual(
    result.map((collector) => collector.collectorId),
    ["collector-1", "collector-2"],
  );
  assert.deepEqual(calls, [
    { orgId: "org-alpha", limit: 100, offset: 0 },
    { orgId: "org-alpha", limit: 100, offset: 1 },
  ]);
});

const QUEUE_STATUS = {
  name: "collector-processing",
  waiting: 2,
  active: 1,
  completed: 40,
  failed: 2,
  delayed: 1,
  isPaused: false,
} as const;

function createUseCase(repository: ICollectorMonitoringRepository) {
  return new GetCollectorStatusUseCase(
    repository,
    { async getStatus() { return QUEUE_STATUS; } },
    { async getStatus() { return { count: 3 }; } },
    { async getStatus() { return AI_ENGINE_STATUS; } },
  );
}

const AI_ENGINE_STATUS = {
  status: "online",
  modelVersion: "v20260912_120000",
  uptimeSeconds: 3600,
  totalPredictions: 250,
  avgLatencyMs: 18.5,
  p99LatencyMs: 52,
} as const;

function createRecord() {
  return {
    collectorId: "collector-alpha",
    status: "degraded" as const,
    lastHeartbeatAt: new Date("2026-09-10T12:00:00.000Z"),
    heartbeatData: {
      canonical_unsigned_sha256: "signature-must-not-leak",
      metrics: {
        disk_available_bytes: 4096,
        last_batch_id: "batch-42",
      },
    },
    filesProcessed: 42,
    eventsCollected: 900,
    eventsDropped: 4,
    errorsCount: 2,
    cpuPercent: 17.5,
    memoryMb: 256,
    firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

function createDatabaseRecord(collectorId: string): CollectorStatusRecord {
  return {
    id: `${collectorId}-id`,
    ...createRecord(),
    collectorId,
    updatedAt: new Date("2026-09-10T12:00:00.000Z"),
    orgId: "org-alpha",
  };
}
