import assert from "node:assert/strict";
import test from "node:test";

import { HttpAiEngineHealthMonitor } from "../../../src/modules/collector-monitoring/infrastructure/http-ai-engine-health.monitor.js";

test("maps a healthy loaded AI Engine to the dashboard contract", async () => {
  let requestedUrl = "";
  const monitor = createMonitor(async (input) => {
    requestedUrl = String(input);
    return jsonResponse({
      status: "healthy",
      model_loaded: true,
      model_version: "v20260912_120000",
      uptime_seconds: 7200,
      total_predictions: 500,
      avg_latency_ms: 21.5,
      p99_latency_ms: 63,
      errors_total: 2,
    });
  });

  assert.deepEqual(await monitor.getStatus(), {
    status: "online",
    modelVersion: "v20260912_120000",
    uptimeSeconds: 7200,
    totalPredictions: 500,
    avgLatencyMs: 21.5,
    p99LatencyMs: 63,
  });
  assert.equal(requestedUrl, "http://ai.example.test/api/v1/health");
  assert.equal(JSON.stringify(await monitor.getStatus()).includes("errors_total"), false);
});

test("maps a reachable unhealthy AI Engine to degraded without leaking its error", async () => {
  const monitor = createMonitor(async () =>
    jsonResponse(
      {
        status: "unhealthy",
        model_loaded: false,
        error: "Failed to load C:\\private\\model.joblib",
      },
      503,
    ),
  );

  const result = await monitor.getStatus();

  assert.deepEqual(result, {
    status: "degraded",
    modelVersion: null,
    uptimeSeconds: null,
    totalPredictions: null,
    avgLatencyMs: null,
    p99LatencyMs: null,
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("maps an invalid reachable response to degraded", async () => {
  const monitor = createMonitor(async () =>
    jsonResponse({ status: "healthy", model_loaded: "yes" }),
  );

  assert.equal((await monitor.getStatus()).status, "degraded");
});

test("maps transport failures to offline", async () => {
  const monitor = createMonitor(async () => {
    throw new Error("connection refused");
  });

  assert.equal((await monitor.getStatus()).status, "offline");
});

test("caches health for the configured refresh interval", async () => {
  let now = 1_000;
  let calls = 0;
  const monitor = new HttpAiEngineHealthMonitor(
    {
      baseUrl: "http://ai.example.test",
      timeoutMs: 100,
      refreshIntervalMs: 30_000,
    },
    {
      now: () => now,
      fetch: async () => {
        calls += 1;
        return jsonResponse({ status: "healthy", model_loaded: true });
      },
    },
  );

  await Promise.all([monitor.getStatus(), monitor.getStatus()]);
  await monitor.getStatus();
  assert.equal(calls, 1);

  now += 30_001;
  await monitor.getStatus();
  assert.equal(calls, 2);
});

test("validates AI Engine monitor configuration", () => {
  assert.throws(
    () =>
      new HttpAiEngineHealthMonitor({
        baseUrl: "file:///private/health.json",
        timeoutMs: 100,
      }),
    /HTTP or HTTPS/u,
  );
  assert.throws(
    () =>
      new HttpAiEngineHealthMonitor({
        baseUrl: "http://ai.example.test",
        timeoutMs: 0,
      }),
    /positive integer/u,
  );
});

function createMonitor(fetchImplementation: typeof fetch) {
  return new HttpAiEngineHealthMonitor(
    {
      baseUrl: "http://ai.example.test/some/configured/path?unsafe=value",
      timeoutMs: 100,
    },
    { fetch: fetchImplementation },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
