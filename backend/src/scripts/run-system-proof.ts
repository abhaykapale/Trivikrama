import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../database/mongodb/client.js";
import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
} from "../database/postgres/client.js";
import {
  createMongoRepositories,
} from "../database/repositories/mongodb/mongo-repository.factory.js";
import {
  createPostgresRepositories,
} from "../database/repositories/postgres-repository.factory.js";
import {
  closeRedis,
  connectRedis,
  createRedisClient,
} from "../database/redis/client.js";
import {
  formatSystemProof,
  GenerateSystemProofService,
  RepositorySystemProofDataSource,
} from "../modules/system-proof/index.js";

interface CliOptions {
  readonly eventId?: string;
  readonly outputDirectory: string;
  readonly requirePublishedNotification: boolean;
  readonly requireCollectorHeartbeat: boolean;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = requireEnvironment("DATABASE_URL");
  const mongoUri = requireEnvironment("MONGODB_URI");
  const redisUrl = requireEnvironment("REDIS_URL");
  const orgId = (process.env.COLLECTOR_ORG_ID ?? "default").trim();
  // Match the processing worker exactly. Ioredis applies this prefix directly
  // to the publisher's logical deduplication key.
  const redisPrefix = (process.env.REDIS_KEY_PREFIX ?? "trivikrama").trim();
  const postgres = createPostgresClient({
    connectionString: databaseUrl,
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
    statementTimeoutMs: 10_000,
    applicationName: "trivikrama-system-proof",
  });
  const mongo = createMongoDbClient();
  const redis = createRedisClient({ url: redisUrl, keyPrefix: redisPrefix });

  try {
    await Promise.all([
      pingPostgres(postgres),
      connectMongoDb(mongo, {
        uri: mongoUri,
        minPoolSize: 0,
        maxPoolSize: 2,
        serverSelectionTimeoutMs: 5_000,
      }),
      connectRedis(redis),
    ]);

    const dataSource = new RepositorySystemProofDataSource({
      postgres: createPostgresRepositories(postgres),
      mongo: createMongoRepositories(mongo),
      redis,
      async findLatestLinkedEventId(organizationId) {
        const result = await postgres.raw<{ rows: Array<{ event_id: string }> }>(
          `
            SELECT ie.event_id
            FROM public.incident_events ie
            INNER JOIN public.incidents i ON i.id = ie.incident_id
            WHERE i.org_id = ?
            ORDER BY ie.created_at DESC, ie.id DESC
            LIMIT 1
          `,
          [organizationId],
        );
        return result.rows[0]?.event_id ?? null;
      },
    });
    const report = await new GenerateSystemProofService(dataSource).execute({
      orgId,
      ...(options.eventId === undefined ? {} : { eventId: options.eventId }),
      requirePublishedNotification: options.requirePublishedNotification,
      requireCollectorHeartbeat: options.requireCollectorHeartbeat,
    });
    const rendered = formatSystemProof(report);
    const paths = await persistReports(report.eventId, report.generatedAt, rendered, report, options.outputDirectory);

    process.stdout.write(rendered);
    process.stdout.write(`\nJSON evidence: ${paths.json}\n`);
    process.stdout.write(`Text evidence: ${paths.text}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await Promise.allSettled([
      closeMongoDb(mongo),
      closePostgres(postgres),
      closeRedis(redis),
    ]);
  }
}

export function parseOptions(args: readonly string[]): CliOptions {
  let eventId: string | undefined;
  let outputDirectory = "artifacts/system-proof";
  let requirePublishedNotification = true;
  let requireCollectorHeartbeat = true;

  for (const arg of args) {
    if (arg === "--allow-pending-notification") {
      requirePublishedNotification = false;
    } else if (arg === "--allow-missing-heartbeat") {
      requireCollectorHeartbeat = false;
    } else if (arg.startsWith("--output-dir=")) {
      outputDirectory = requireNonBlank(arg.slice("--output-dir=".length), "output directory");
    } else if (arg.startsWith("--event-id=")) {
      eventId = requireNonBlank(arg.slice("--event-id=".length), "event ID");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (eventId === undefined) {
      eventId = requireNonBlank(arg, "event ID");
    } else {
      throw new Error("Only one event ID may be supplied.");
    }
  }

  return Object.freeze({
    ...(eventId === undefined ? {} : { eventId }),
    outputDirectory,
    requirePublishedNotification,
    requireCollectorHeartbeat,
  });
}

async function persistReports(
  eventId: string | null,
  generatedAt: string,
  rendered: string,
  report: unknown,
  outputDirectory: string,
): Promise<{ readonly json: string; readonly text: string }> {
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const eventPart = safeFilename(eventId ?? "no-event");
  const timePart = generatedAt.replace(/[:.]/gu, "-");
  const base = `system-proof-${eventPart}-${timePart}`;
  const json = path.join(directory, `${base}.json`);
  const text = path.join(directory, `${base}.txt`);
  await Promise.all([
    writeFile(json, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
    writeFile(text, rendered, { encoding: "utf8", flag: "wx" }),
  ]);
  return { json, text };
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120);
  return normalized.length === 0 ? "event" : normalized;
}

function requireEnvironment(name: string): string {
  return requireNonBlank(process.env[name] ?? "", name);
}

function requireNonBlank(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} is required.`);
  return normalized;
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
