import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { HttpAiEngineHealthMonitor } from "../../../src/modules/collector-monitoring/infrastructure/http-ai-engine-health.monitor.js";

test("reads the live AI Engine health HTTP contract", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/v1/health");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "healthy",
        model_loaded: true,
        model_version: "v-integration",
        uptime_seconds: 99,
        total_predictions: 12,
        avg_latency_ms: 4.5,
        p99_latency_ms: 9,
      }),
    );
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  const monitor = new HttpAiEngineHealthMonitor({
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 500,
  });

  try {
    assert.deepEqual(await monitor.getStatus(), {
      status: "online",
      modelVersion: "v-integration",
      uptimeSeconds: 99,
      totalPredictions: 12,
      avgLatencyMs: 4.5,
      p99LatencyMs: 9,
    });
  } finally {
    await monitor.close();
    await close(server);
  }
});

test("returns offline when the AI Engine exceeds its timeout", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "healthy", model_loaded: true }));
    }, 100);
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  const monitor = new HttpAiEngineHealthMonitor({
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 20,
  });

  try {
    assert.equal((await monitor.getStatus()).status, "offline");
  } finally {
    await monitor.close();
    await close(server);
  }
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
