import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Redis, type RedisOptions } from "ioredis";

import type {
  RedisCheckResult,
  RedisKeyPatternStatus,
  RedisRuntimeInfo,
  RedisVerificationCommand,
  RedisVerificationConfig,
  RedisVerificationResult,
} from "./verification.types.js";

const MINIMUM_SUPPORTED_REDIS_MAJOR_VERSION = 7;
const MAX_RECONNECT_DELAY_MS = 2_000;

const NAMESPACED_KEY_PATTERNS = [
  {
    name: "dashboard-cache",
    patternSuffix: "cache:dash:*",
  },
  {
    name: "session-cache",
    patternSuffix: "cache:session:*",
  },
  {
    name: "incident-cache",
    patternSuffix: "cache:incident:*",
  },
  {
    name: "rule-cache",
    patternSuffix: "cache:rules:*",
  },
  {
    name: "asset-criticality-cache",
    patternSuffix: "cache:asset:crit:*",
  },
  {
    name: "rate-limit",
    patternSuffix: "rl:*",
  },
  {
    name: "rule-cooldown",
    patternSuffix: "rule:cooldown:*",
  },
  {
    name: "rule-count-window",
    patternSuffix: "rule:count:*",
  },
  {
    name: "queue",
    patternSuffix: "queue:*",
  },
  {
    name: "bullmq",
    patternSuffix: "bull:*",
  },
] as const;

interface RedisProbeContext {
  readonly client: Redis;
  readonly config: RedisVerificationConfig;
  readonly probeId: string;
  readonly checks: RedisCheckResult[];
}

export async function runRedisVerification(
  command: RedisVerificationCommand,
  config: RedisVerificationConfig,
): Promise<RedisVerificationResult> {
  const startedAtDate = new Date();
  const startedAt = performance.now();
  const checks: RedisCheckResult[] = [];
  const client = createRedisToolClient(config, "verify");
  let keyspace: RedisKeyPatternStatus[] = [];
  let runtimeInfo: RedisRuntimeInfo = {
    url: redactRedisUrl(config.url),
    database: parseRedisDatabase(config.url),
    keyPrefix: config.keyPrefix,
  };

  try {
    await connectAndPing(client, checks);

    runtimeInfo = {
      ...runtimeInfo,
      ...(await loadRedisRuntimeInfo(client)),
    };

    checks.push(checkServerVersion(runtimeInfo.serverVersion));
    await checkProductionRuntimeConfig(client, config, checks);

    keyspace = await scanKnownKeyPatterns(client, config);

    if (command === "verify") {
      const context: RedisProbeContext = {
        client,
        config,
        probeId: randomUUID(),
        checks,
      };

      await verifyStringCache(context);
      await verifyCounterWithTtl(context);
      await verifyQueuePrimitive(context);
      await verifyPubSub(config, context.probeId, checks);
    }
  } catch (error) {
    checks.push({
      name: "redis-verification",
      status: "fail",
      message: toErrorMessage(error),
    });
  } finally {
    await closeRedisToolClient(client);
  }

  const finishedAt = new Date();
  const failed = checks.some((check) => check.status === "fail");

  return {
    command,
    nodeEnv: config.nodeEnv,
    success: !failed,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    redis: runtimeInfo,
    checks,
    keyspace,
  };
}

function createRedisToolClient(
  config: RedisVerificationConfig,
  purpose: string,
): Redis {
  const options: RedisOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    connectionName: `trivikrama-${purpose}`,
    retryStrategy(attempt: number): number {
      return Math.min(attempt * 100, MAX_RECONNECT_DELAY_MS);
    },
  };

  const client = new Redis(config.url, options);
  client.on("error", () => undefined);

  return client;
}

async function connectAndPing(
  client: Redis,
  checks: RedisCheckResult[],
): Promise<void> {
  const startedAt = performance.now();

  if (client.status === "wait") {
    await client.connect();
  }

  const response = await client.ping();
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

  checks.push({
    name: "ping",
    status: response === "PONG" ? "pass" : "fail",
    message:
      response === "PONG"
        ? "Redis responded to PING."
        : "Redis returned an unexpected PING response.",
    latencyMs,
    details: {
      response,
    },
  });
}

async function loadRedisRuntimeInfo(
  client: Redis,
): Promise<Partial<RedisRuntimeInfo>> {
  const [serverInfo, clientsInfo, memoryInfo, replicationInfo] =
    await Promise.all([
      safeInfo(client, "server"),
      safeInfo(client, "clients"),
      safeInfo(client, "memory"),
      safeInfo(client, "replication"),
    ]);

  const [maxMemoryPolicy, appendOnly] = await Promise.all([
    safeConfigGet(client, "maxmemory-policy"),
    safeConfigGet(client, "appendonly"),
  ]);

  return {
    serverVersion: parseInfoValue(serverInfo, "redis_version"),
    role: parseInfoValue(replicationInfo, "role"),
    connectedClients: parseOptionalInteger(
      parseInfoValue(clientsInfo, "connected_clients"),
    ),
    usedMemoryHuman: parseInfoValue(memoryInfo, "used_memory_human"),
    maxMemoryPolicy,
    appendOnly,
  };
}

function checkServerVersion(serverVersion: string | undefined): RedisCheckResult {
  if (!serverVersion) {
    return {
      name: "server-version",
      status: "warn",
      message: "Redis server version could not be read from INFO.",
    };
  }

  const majorVersion = Number.parseInt(serverVersion.split(".")[0] ?? "", 10);

  if (Number.isInteger(majorVersion) && majorVersion >= MINIMUM_SUPPORTED_REDIS_MAJOR_VERSION) {
    return {
      name: "server-version",
      status: "pass",
      message: `Redis ${serverVersion} satisfies the documented Redis 7.x baseline.`,
      details: {
        serverVersion,
      },
    };
  }

  return {
    name: "server-version",
    status: "warn",
    message: `Redis ${serverVersion} is below the documented Redis 7.x baseline.`,
    details: {
      serverVersion,
    },
  };
}

async function checkProductionRuntimeConfig(
  client: Redis,
  config: RedisVerificationConfig,
  checks: RedisCheckResult[],
): Promise<void> {
  const maxMemoryPolicy = await safeConfigGet(client, "maxmemory-policy");
  const appendOnly = await safeConfigGet(client, "appendonly");

  if (config.nodeEnv === "production") {
    checks.push({
      name: "production-maxmemory-policy",
      status: maxMemoryPolicy === "allkeys-lru" ? "pass" : "warn",
      message:
        maxMemoryPolicy === "allkeys-lru"
          ? "Redis maxmemory-policy is allkeys-lru."
          : "Production Redis should use maxmemory-policy allkeys-lru according to the deployment design.",
      details: {
        maxMemoryPolicy,
      },
    });

    checks.push({
      name: "production-aof",
      status: appendOnly === "yes" ? "pass" : "warn",
      message:
        appendOnly === "yes"
          ? "Redis appendonly persistence is enabled."
          : "Production Redis should enable appendonly persistence according to the deployment design.",
      details: {
        appendOnly,
      },
    });
  } else {
    checks.push({
      name: "runtime-config-readable",
      status: maxMemoryPolicy || appendOnly ? "pass" : "warn",
      message:
        maxMemoryPolicy || appendOnly
          ? "Redis runtime configuration is readable."
          : "Redis CONFIG values could not be read; this can be normal on managed Redis.",
      details: {
        maxMemoryPolicy,
        appendOnly,
      },
    });
  }

  await client.ping();
}

async function verifyStringCache(context: RedisProbeContext): Promise<void> {
  const key = namespacedKey(context.config.keyPrefix, `verify:string:${context.probeId}`);
  const value = JSON.stringify({ probeId: context.probeId, purpose: "cache" });
  const startedAt = performance.now();

  try {
    await context.client.set(key, value, "EX", 30);
    const [storedValue, ttl] = await Promise.all([
      context.client.get(key),
      context.client.ttl(key),
    ]);
    await context.client.del(key);

    context.checks.push({
      name: "cache-setex-get-del",
      status: storedValue === value && ttl > 0 ? "pass" : "fail",
      message:
        storedValue === value && ttl > 0
          ? "Redis supports namespaced SETEX/GET/DEL cache operations."
          : "Redis cache probe returned an unexpected value or missing TTL.",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      details: {
        key,
        ttl,
      },
    });
  } finally {
    await context.client.del(key);
  }
}

async function verifyCounterWithTtl(context: RedisProbeContext): Promise<void> {
  const key = namespacedKey(context.config.keyPrefix, `verify:counter:${context.probeId}`);
  const startedAt = performance.now();

  try {
    const count = await context.client.incr(key);
    await context.client.expire(key, 60);
    const ttl = await context.client.ttl(key);

    context.checks.push({
      name: "counter-incr-expire",
      status: count === 1 && ttl > 0 ? "pass" : "fail",
      message:
        count === 1 && ttl > 0
          ? "Redis supports counter + TTL operations needed by rate limits and rule windows."
          : "Redis counter probe returned an unexpected count or missing TTL.",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      details: {
        key,
        count,
        ttl,
      },
    });
  } finally {
    await context.client.del(key);
  }
}

async function verifyQueuePrimitive(context: RedisProbeContext): Promise<void> {
  const key = namespacedKey(context.config.keyPrefix, `verify:queue:${context.probeId}`);
  const payload = JSON.stringify({ jobId: context.probeId, source: "redis-verify" });
  const startedAt = performance.now();

  try {
    await context.client.rpush(key, payload);
    const popped = await context.client.lpop(key);
    await context.client.del(key);

    context.checks.push({
      name: "queue-list-primitive",
      status: popped === payload ? "pass" : "fail",
      message:
        popped === payload
          ? "Redis list primitives are available for queue capability checks."
          : "Redis list primitive probe returned an unexpected payload.",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      details: {
        key,
      },
    });
  } finally {
    await context.client.del(key);
  }
}

async function verifyPubSub(
  config: RedisVerificationConfig,
  probeId: string,
  checks: RedisCheckResult[],
): Promise<void> {
  const channel = namespacedKey(config.keyPrefix, `verify:pubsub:${probeId}`);
  const payload = JSON.stringify({ probeId, type: "pubsub-probe" });
  const subscriber = createRedisToolClient(config, "verify-subscriber");
  const publisher = createRedisToolClient(config, "verify-publisher");
  const startedAt = performance.now();

  try {
    await Promise.all([subscriber.connect(), publisher.connect()]);

    const received = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), config.pubSubTimeoutMs);

      subscriber.on("message", (receivedChannel: string, message: string) => {
        if (receivedChannel === channel && message === payload) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    await subscriber.subscribe(channel);
    await publisher.publish(channel, payload);

    const messageReceived = await received;
    await subscriber.unsubscribe(channel);

    checks.push({
      name: "pubsub-roundtrip",
      status: messageReceived ? "pass" : "fail",
      message: messageReceived
        ? "Redis Pub/Sub roundtrip succeeded."
        : "Redis Pub/Sub probe timed out before receiving the message.",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      details: {
        channel,
        timeoutMs: config.pubSubTimeoutMs,
      },
    });
  } finally {
    await Promise.all([
      closeRedisToolClient(subscriber),
      closeRedisToolClient(publisher),
    ]);
  }
}

async function scanKnownKeyPatterns(
  client: Redis,
  config: RedisVerificationConfig,
): Promise<RedisKeyPatternStatus[]> {
  const results: RedisKeyPatternStatus[] = [];

  for (const definition of NAMESPACED_KEY_PATTERNS) {
    const pattern = namespacedKey(config.keyPrefix, definition.patternSuffix);
    const scanResult = await sampleKeyPattern(client, pattern, config.scanLimit);

    results.push({
      name: definition.name,
      pattern,
      sampledKeys: scanResult.sampledKeys,
      scanComplete: scanResult.scanComplete,
    });
  }

  return results;
}

async function sampleKeyPattern(
  client: Redis,
  pattern: string,
  scanLimit: number,
): Promise<{ readonly sampledKeys: number; readonly scanComplete: boolean }> {
  let cursor = "0";
  let sampledKeys = 0;
  let scannedIterations = 0;
  const maxIterations = Math.max(1, Math.ceil(scanLimit / 100));

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "100",
    );

    cursor = nextCursor;
    sampledKeys += keys.length;
    scannedIterations += 1;
  } while (cursor !== "0" && scannedIterations < maxIterations && sampledKeys < scanLimit);

  return {
    sampledKeys,
    scanComplete: cursor === "0",
  };
}

async function safeInfo(client: Redis, section: string): Promise<string> {
  try {
    return await client.info(section);
  } catch {
    return "";
  }
}

async function safeConfigGet(
  client: Redis,
  key: string,
): Promise<string | undefined> {
  try {
    const result = await client.call("CONFIG", "GET", key);

    if (Array.isArray(result) && typeof result[1] === "string") {
      return result[1];
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function closeRedisToolClient(client: Redis): Promise<void> {
  if (client.status === "end") {
    return;
  }

  if (client.status === "ready") {
    try {
      await client.quit();
      return;
    } catch {
      // Shutdown verification should not hang because Redis disappeared.
    }
  }

  client.disconnect();
}

function parseInfoValue(info: string, key: string): string | undefined {
  const line = info
    .split("\n")
    .find((entry) => entry.startsWith(`${key}:`));

  return line?.split(":").slice(1).join(":").trim();
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRedisDatabase(url: string): number | null {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//u, "");

    if (database.length === 0) {
      return 0;
    }

    const numericDatabase = Number.parseInt(database, 10);

    return Number.isFinite(numericDatabase) ? numericDatabase : null;
  } catch {
    return null;
  }
}

function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.password) {
      parsed.password = "***";
    }

    return parsed.toString();
  } catch {
    return "<invalid redis url>";
  }
}

function namespacedKey(prefix: string, suffix: string): string {
  return `${prefix}:${suffix.replace(/^:+/u, "")}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
