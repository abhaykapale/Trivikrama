import { performance } from "node:perf_hooks";

import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../mongodb/index.js";
import { runMongoDbBootstrap } from "../mongodb/bootstrap.js";
import type {
  DatabaseComponentVerificationResult,
  DatabaseVerificationCheck,
  MongoVerificationConfig,
} from "./verification.types.js";

export async function verifyMongoDb(
  config: MongoVerificationConfig,
): Promise<DatabaseComponentVerificationResult> {
  const startedAtDate = new Date();
  const startedAt = performance.now();
  const checks: DatabaseVerificationCheck[] = [];
  const client = createMongoDbClient();
  let summary: Record<string, unknown> = {};

  try {
    const connectStartedAt = performance.now();
    await connectMongoDb(client, {
      uri: config.uri,
      minPoolSize: 0,
      maxPoolSize: config.poolSize,
      serverSelectionTimeoutMs: config.serverSelectionTimeoutMs,
      connectTimeoutMs: config.connectTimeoutMs,
      socketTimeoutMs: config.socketTimeoutMs,
    });
    checks.push({
      name: "connectivity",
      status: "pass",
      message: "MongoDB connection succeeded.",
      latencyMs: Math.max(0, Math.round(performance.now() - connectStartedAt)),
    });

    const statusStartedAt = performance.now();
    const result = await runMongoDbBootstrap(client, "status");
    const missingCollections = result.collections
      .filter((collection) => !collection.exists)
      .map((collection) => collection.name);
    const validatorMissing = result.collections
      .filter((collection) => collection.exists && !collection.validatorConfigured)
      .map((collection) => collection.name);
    const missingIndexes = result.collections.flatMap((collection) =>
      collection.missingIndexes.map((index) => `${collection.name}.${index}`),
    );
    const mismatchedIndexes = result.collections.flatMap((collection) =>
      collection.mismatchedIndexes.map((index) => `${collection.name}.${index}`),
    );

    summary = {
      databaseName: result.databaseName,
      collections: result.collections.length,
      missingCollections: missingCollections.length,
      missingIndexes: missingIndexes.length,
      mismatchedIndexes: mismatchedIndexes.length,
    };

    if (result.success) {
      checks.push({
        name: "bootstrap-status",
        status: "pass",
        message: "MongoDB collections, validators, and indexes match the bootstrap definition.",
        latencyMs: Math.max(0, Math.round(performance.now() - statusStartedAt)),
        details: {
          databaseName: result.databaseName,
          collections: result.collections.map((collection) => ({
            name: collection.name,
            expectedIndexes: collection.expectedIndexes,
            presentIndexes: collection.presentIndexes.length,
          })),
        },
      });
    } else {
      checks.push({
        name: "bootstrap-status",
        status: "fail",
        message: "MongoDB bootstrap status is incomplete or mismatched.",
        latencyMs: Math.max(0, Math.round(performance.now() - statusStartedAt)),
        details: {
          missingCollections,
          validatorMissing,
          missingIndexes,
          mismatchedIndexes,
        },
      });
    }
  } catch (error) {
    checks.push({
      name: "mongodb-verification",
      status: "fail",
      message: toSafeErrorMessage(error),
    });
  } finally {
    await closeMongoDb(client);
  }

  const finishedAt = new Date();
  const failed = checks.some((check) => check.status === "fail");

  return {
    component: "mongodb",
    success: !failed,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    checks,
    summary,
  };
}

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(/(mongodb(?:\+srv)?:\/\/[^:\s/]+:)([^@\s]+)(@)/giu, "$1****$3");
}
