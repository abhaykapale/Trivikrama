import assert from "node:assert/strict";
import test from "node:test";

import { ShutdownCoordinator } from "../../../src/runtime/shutdown-coordinator.js";

test("closes resources in registration order", async () => {
  const closeOrder: string[] = [];
  const coordinator = new ShutdownCoordinator([
    {
      name: "worker",
      close: async () => {
        closeOrder.push("worker");
      },
    },
    {
      name: "http",
      close: async () => {
        closeOrder.push("http");
      },
    },
    {
      name: "databases",
      close: async () => {
        closeOrder.push("databases");
      },
    },
  ]);

  const result = await coordinator.shutdown();

  assert.deepEqual(closeOrder, ["worker", "http", "databases"]);
  assert.deepEqual(result.closed, ["worker", "http", "databases"]);
  assert.deepEqual(result.failures, []);
});

test("continues closing resources after a failure", async () => {
  const closeOrder: string[] = [];
  const coordinator = new ShutdownCoordinator([
    {
      name: "first",
      close: async () => {
        closeOrder.push("first");
        throw new Error("first close failed");
      },
    },
    {
      name: "second",
      close: async () => {
        closeOrder.push("second");
      },
    },
  ]);

  const result = await coordinator.shutdown();

  assert.deepEqual(closeOrder, ["first", "second"]);
  assert.deepEqual(result.closed, ["second"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.resourceName, "first");
});

test("runs one shutdown operation when called repeatedly", async () => {
  let closeCount = 0;
  const coordinator = new ShutdownCoordinator([
    {
      name: "database",
      close: async () => {
        closeCount += 1;
      },
    },
  ]);

  const [first, second] = await Promise.all([
    coordinator.shutdown(),
    coordinator.shutdown(),
  ]);

  assert.equal(closeCount, 1);
  assert.equal(first, second);
});
