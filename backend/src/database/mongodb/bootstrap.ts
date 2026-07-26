import { performance } from "node:perf_hooks";

import type { MongoDbClient } from "./client.js";
import type {
  MongoBootstrapCollectionStatus,
  MongoBootstrapCommand,
  MongoBootstrapResult,
  MongoCollectionDefinition,
  MongoIndexDefinition,
} from "./bootstrap.types.js";

const NORMALIZED_EVENTS_COLLECTION = "normalized_events";
const AI_RESULTS_COLLECTION = "ai_results";
const RAW_EVENTS_ARCHIVE_COLLECTION = "raw_events_archive";

const NORMALIZED_EVENTS_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const AI_RESULTS_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const RAW_EVENTS_ARCHIVE_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export const MONGO_COLLECTION_DEFINITIONS: readonly MongoCollectionDefinition[] = [
  {
    name: NORMALIZED_EVENTS_COLLECTION,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "event_id",
          "class_uid",
          "category_uid",
          "severity_id",
          "time",
          "message",
          "metadata",
          "ingestion",
        ],
        properties: {
          event_id: {
            bsonType: "string",
            description: "Unique event identifier (UUID v4)",
          },
          dedup_hash: {
            bsonType: "string",
            description: "SHA-256 deduplication hash",
          },
          class_uid: {
            bsonType: "int",
            description: "OCSF event class UID",
          },
          category_uid: {
            bsonType: "int",
            description: "OCSF event category UID",
          },
          severity_id: {
            bsonType: "int",
            minimum: 0,
            maximum: 6,
            description:
              "OCSF severity (0=Unknown, 1=Info, 2=Low, 3=Medium, 4=High, 5=Critical, 6=Fatal)",
          },
          time: {
            bsonType: "date",
            description: "Event timestamp normalized to UTC",
          },
          message: {
            bsonType: "string",
            description: "Human-readable event message",
          },
          src_endpoint: {
            bsonType: "object",
            properties: {
              ip: { bsonType: "string" },
              hostname: { bsonType: "string" },
              port: { bsonType: "int" },
              mac: { bsonType: "string" },
            },
          },
          dst_endpoint: {
            bsonType: "object",
            properties: {
              ip: { bsonType: "string" },
              hostname: { bsonType: "string" },
              port: { bsonType: "int" },
              mac: { bsonType: "string" },
            },
          },
          actor: {
            bsonType: "object",
            properties: {
              user: {
                bsonType: "object",
                properties: {
                  name: { bsonType: "string" },
                  uid: { bsonType: "string" },
                  domain: { bsonType: "string" },
                  type: { bsonType: "string" },
                },
              },
              process: {
                bsonType: "object",
                properties: {
                  name: { bsonType: "string" },
                  pid: { bsonType: "int" },
                  cmd_line: { bsonType: "string" },
                  path: { bsonType: "string" },
                },
              },
              session: {
                bsonType: "object",
                properties: {
                  uid: { bsonType: "string" },
                  type: { bsonType: "string" },
                },
              },
            },
          },
          device: {
            bsonType: "object",
            properties: {
              hostname: { bsonType: "string" },
              ip: { bsonType: "string" },
              os: {
                bsonType: "object",
                properties: {
                  name: { bsonType: "string" },
                  version: { bsonType: "string" },
                },
              },
              type: { bsonType: "string" },
            },
          },
          metadata: {
            bsonType: "object",
            required: ["version"],
            properties: {
              version: { bsonType: "string" },
              product: {
                bsonType: "object",
                properties: {
                  name: { bsonType: "string" },
                  vendor_name: { bsonType: "string" },
                  version: { bsonType: "string" },
                },
              },
              log_level: { bsonType: "string" },
            },
          },
          enrichments: {
            bsonType: "object",
            properties: {
              geo_src: {
                bsonType: "object",
                properties: {
                  country: { bsonType: "string" },
                  city: { bsonType: "string" },
                  latitude: { bsonType: "double" },
                  longitude: { bsonType: "double" },
                  asn: { bsonType: "string" },
                },
              },
              geo_dst: {
                bsonType: "object",
                properties: {
                  country: { bsonType: "string" },
                  city: { bsonType: "string" },
                  latitude: { bsonType: "double" },
                  longitude: { bsonType: "double" },
                  asn: { bsonType: "string" },
                },
              },
              reverse_dns_src: { bsonType: "string" },
              reverse_dns_dst: { bsonType: "string" },
              asset_criticality: { bsonType: "double" },
            },
          },
          features: {
            bsonType: "object",
            properties: {
              temporal: { bsonType: "object" },
              frequency: { bsonType: "object" },
              entropy: { bsonType: "object" },
              volume: { bsonType: "object" },
              process: { bsonType: "object" },
              authentication: { bsonType: "object" },
              network: { bsonType: "object" },
            },
          },
          unmapped: {
            bsonType: "object",
            description: "Fields not mapped to OCSF schema",
          },
          schema_valid: {
            bsonType: "bool",
            description: "Whether event passed OCSF schema validation",
          },
          validation_errors: {
            bsonType: "array",
            items: { bsonType: "string" },
          },
          ingestion: {
            bsonType: "object",
            required: ["batch_id", "collector_id", "ingested_at"],
            properties: {
              batch_id: { bsonType: "string" },
              collector_id: { bsonType: "string" },
              ingested_at: { bsonType: "date" },
              pipeline_duration_ms: { bsonType: "int" },
            },
          },
          raw_event: {
            bsonType: "object",
            description: "Original event before normalization",
          },
          org_id: { bsonType: "string" },
        },
      },
    },
    indexes: [
      { name: "idx_event_id", keys: { event_id: 1 }, unique: true },
      { name: "idx_dedup_hash", keys: { dedup_hash: 1 } },
      { name: "idx_time_desc", keys: { time: -1 } },
      { name: "idx_severity_time", keys: { severity_id: 1, time: -1 } },
      { name: "idx_class_time", keys: { class_uid: 1, time: -1 } },
      {
        name: "idx_src_ip_time",
        keys: { "src_endpoint.ip": 1, time: -1 },
        sparse: true,
      },
      {
        name: "idx_dst_ip_time",
        keys: { "dst_endpoint.ip": 1, time: -1 },
        sparse: true,
      },
      {
        name: "idx_actor_user_time",
        keys: { "actor.user.name": 1, time: -1 },
        sparse: true,
      },
      {
        name: "idx_device_hostname_time",
        keys: { "device.hostname": 1, time: -1 },
        sparse: true,
      },
      { name: "idx_batch_id", keys: { "ingestion.batch_id": 1 } },
      {
        name: "idx_collector_time",
        keys: { "ingestion.collector_id": 1, time: -1 },
      },
      { name: "idx_message_text", keys: { message: "text" } },
      {
        name: "idx_ttl_expiry",
        keys: { "ingestion.ingested_at": 1 },
        expireAfterSeconds: NORMALIZED_EVENTS_RETENTION_SECONDS,
      },
      { name: "idx_org_time", keys: { org_id: 1, time: -1 } },
    ],
  },
  {
    name: AI_RESULTS_COLLECTION,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "event_id",
          "model_name",
          "model_version",
          "anomaly_score",
          "is_anomaly",
          "created_at",
        ],
        properties: {
          event_id: {
            bsonType: "string",
            description: "References normalized_events.event_id",
          },
          batch_id: {
            bsonType: "string",
            description: "Batch this result was produced in",
          },
          model_name: {
            bsonType: "string",
            description: "Model identifier",
          },
          model_version: {
            bsonType: "string",
            description: "Model version string",
          },
          anomaly_score: {
            bsonType: "double",
            description: "Anomaly score 0.0 to 1.0",
          },
          is_anomaly: {
            bsonType: "bool",
            description: "Whether score exceeds threshold",
          },
          confidence: {
            bsonType: "double",
            description: "Model confidence 0.0 to 1.0",
          },
          threat_category: {
            bsonType: "string",
            description: "Classification result",
          },
          threat_confidence: { bsonType: "double" },
          shap_explanation: {
            bsonType: "object",
            properties: {
              base_value: {
                bsonType: "double",
                description: "Expected model output",
              },
              features: {
                bsonType: "array",
                description:
                  "Feature contributions sorted by absolute SHAP value",
                items: {
                  bsonType: "object",
                  properties: {
                    name: { bsonType: "string" },
                    value: { bsonType: "double" },
                    shap_value: { bsonType: "double" },
                  },
                },
              },
            },
          },
          input_features: {
            bsonType: "object",
            description: "Feature vector sent to the model",
          },
          processing_time_ms: {
            bsonType: "int",
            description: "Model inference time",
          },
          used_fallback: {
            bsonType: "bool",
            description: "Whether fallback was used",
          },
          created_at: { bsonType: "date" },
          org_id: { bsonType: "string" },
        },
      },
    },
    indexes: [
      { name: "idx_ai_event_id", keys: { event_id: 1 } },
      {
        name: "idx_ai_anomaly_score",
        keys: { anomaly_score: -1, created_at: -1 },
      },
      { name: "idx_ai_is_anomaly", keys: { is_anomaly: 1, created_at: -1 } },
      {
        name: "idx_ai_model_version",
        keys: { model_name: 1, model_version: 1, created_at: -1 },
      },
      { name: "idx_ai_batch_id", keys: { batch_id: 1 } },
      {
        name: "idx_ai_ttl_expiry",
        keys: { created_at: 1 },
        expireAfterSeconds: AI_RESULTS_RETENTION_SECONDS,
      },
    ],
  },
  {
    name: RAW_EVENTS_ARCHIVE_COLLECTION,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["batch_id", "collector_id", "events", "archived_at"],
        properties: {
          batch_id: {
            bsonType: "string",
            description: "Collector batch identifier",
          },
          collector_id: { bsonType: "string" },
          event_count: { bsonType: "int" },
          schema_version: { bsonType: "string" },
          events: {
            bsonType: "array",
            description: "Raw OCSF events from collector batch file",
          },
          file_size_bytes: { bsonType: "int" },
          archived_at: { bsonType: "date" },
          org_id: { bsonType: "string" },
        },
      },
    },
    indexes: [
      { name: "idx_raw_batch_id", keys: { batch_id: 1 }, unique: true },
      { name: "idx_raw_collector", keys: { collector_id: 1, archived_at: -1 } },
      {
        name: "idx_raw_ttl_expiry",
        keys: { archived_at: 1 },
        expireAfterSeconds: RAW_EVENTS_ARCHIVE_RETENTION_SECONDS,
      },
    ],
  },
];

interface BootstrapCounters {
  collectionsCreated: number;
  validatorsApplied: number;
  indexesCreated: number;
}

interface ExistingIndexDocument {
  readonly name?: string;
  readonly key?: Record<string, unknown>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly weights?: Record<string, number>;
}

interface ExistingCollectionInfo {
  readonly name?: string;
  readonly options?: {
    readonly validator?: Record<string, unknown>;
  };
}

export async function runMongoDbBootstrap(
  client: MongoDbClient,
  command: MongoBootstrapCommand,
): Promise<MongoBootstrapResult> {
  validateBootstrapCommand(command);
  const db = requireConnectedDb(client);
  const startedAt = new Date();
  const startedAtMs = performance.now();
  const counters: BootstrapCounters = {
    collectionsCreated: 0,
    validatorsApplied: 0,
    indexesCreated: 0,
  };

  if (command === "apply") {
    for (const collection of MONGO_COLLECTION_DEFINITIONS) {
      await ensureCollection(db, collection, counters);
      await ensureIndexes(db, collection, counters);
    }
  }

  const collections = await readMongoBootstrapStatus(client);
  const finishedAt = new Date();
  const success = collections.every(
    (collection) =>
      collection.exists &&
      collection.validatorConfigured &&
      collection.missingIndexes.length === 0 &&
      collection.mismatchedIndexes.length === 0,
  );

  return {
    command,
    success,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
    databaseName: db.databaseName,
    collectionsCreated: counters.collectionsCreated,
    validatorsApplied: counters.validatorsApplied,
    indexesCreated: counters.indexesCreated,
    collections,
  };
}

export async function readMongoBootstrapStatus(
  client: MongoDbClient,
): Promise<MongoBootstrapCollectionStatus[]> {
  const db = requireConnectedDb(client);
  const statuses: MongoBootstrapCollectionStatus[] = [];

  for (const definition of MONGO_COLLECTION_DEFINITIONS) {
    const collectionInfo = await readCollectionInfo(db, definition.name);

    if (!collectionInfo) {
      statuses.push({
        name: definition.name,
        exists: false,
        validatorConfigured: false,
        expectedIndexes: definition.indexes.length,
        presentIndexes: [],
        missingIndexes: definition.indexes.map((index) => index.name),
        mismatchedIndexes: [],
      });
      continue;
    }

    const existingIndexes = await readExistingIndexes(db, definition.name);
    const missingIndexes = definition.indexes
      .filter((expected) => !existingIndexes.has(expected.name))
      .map((expected) => expected.name);
    const mismatchedIndexes = definition.indexes
      .filter((expected) => {
        const existing = existingIndexes.get(expected.name);
        return existing !== undefined && !isMatchingIndex(existing, expected);
      })
      .map((expected) => expected.name);

    statuses.push({
      name: definition.name,
      exists: true,
      validatorConfigured: Boolean(collectionInfo.options?.validator),
      expectedIndexes: definition.indexes.length,
      presentIndexes: Array.from(existingIndexes.keys()).sort(),
      missingIndexes,
      mismatchedIndexes,
    });
  }

  return statuses;
}

async function ensureCollection(
  db: NonNullable<MongoDbClient["db"]>,
  definition: MongoCollectionDefinition,
  counters: BootstrapCounters,
): Promise<void> {
  const existing = await readCollectionInfo(db, definition.name);

  if (!existing) {
    await db.createCollection(definition.name, {
      validator: definition.validator,
      validationAction: "error",
      validationLevel: "moderate",
    });
    counters.collectionsCreated += 1;
    counters.validatorsApplied += 1;
    return;
  }

  await db.command({
    collMod: definition.name,
    validator: definition.validator,
    validationAction: "error",
    validationLevel: "moderate",
  });
  counters.validatorsApplied += 1;
}

async function ensureIndexes(
  db: NonNullable<MongoDbClient["db"]>,
  definition: MongoCollectionDefinition,
  counters: BootstrapCounters,
): Promise<void> {
  const collection = db.collection(definition.name);
  const existingIndexes = await readExistingIndexes(db, definition.name);

  for (const index of definition.indexes) {
    const existing = existingIndexes.get(index.name);

    if (existing !== undefined) {
      if (!isMatchingIndex(existing, index)) {
        throw new Error(
          `MongoDB index ${definition.name}.${index.name} already exists with a different definition. Review manually before changing production indexes.`,
        );
      }

      continue;
    }

    await collection.createIndex(index.keys, {
  name: index.name,
  background: true,
  ...(typeof index.unique === "boolean"
    ? { unique: index.unique }
    : {}),
  ...(typeof index.sparse === "boolean"
    ? { sparse: index.sparse }
    : {}),
  ...(typeof index.expireAfterSeconds === "number"
    ? { expireAfterSeconds: index.expireAfterSeconds }
    : {}),
});
    counters.indexesCreated += 1;
  }
}

async function readCollectionInfo(
  db: NonNullable<MongoDbClient["db"]>,
  collectionName: string,
): Promise<ExistingCollectionInfo | undefined> {
  const collections = (await db
    .listCollections({ name: collectionName })
    .toArray()) as ExistingCollectionInfo[];

  return collections[0];
}

async function readExistingIndexes(
  db: NonNullable<MongoDbClient["db"]>,
  collectionName: string,
): Promise<Map<string, ExistingIndexDocument>> {
  const indexes = (await db
    .collection(collectionName)
    .listIndexes()
    .toArray()) as ExistingIndexDocument[];
  const byName = new Map<string, ExistingIndexDocument>();

  for (const index of indexes) {
    if (index.name) {
      byName.set(index.name, index);
    }
  }

  return byName;
}

function isMatchingIndex(
  existing: ExistingIndexDocument,
  expected: MongoIndexDefinition,
): boolean {
  const keysMatch = isTextIndex(expected)
    ? isMatchingTextIndex(existing, expected)
    : stringifyKeys(existing.key ?? {}) === stringifyKeys(expected.keys);

  return (
    keysMatch &&
    Boolean(existing.unique) === Boolean(expected.unique) &&
    Boolean(existing.sparse) === Boolean(expected.sparse) &&
    normalizeExpireAfterSeconds(existing.expireAfterSeconds) ===
      normalizeExpireAfterSeconds(expected.expireAfterSeconds)
  );
}

function isTextIndex(expected: MongoIndexDefinition): boolean {
  return Object.values(expected.keys).some((value) => value === "text");
}

function isMatchingTextIndex(
  existing: ExistingIndexDocument,
  expected: MongoIndexDefinition,
): boolean {
  if (existing.key?._fts !== "text") {
    return false;
  }

  const expectedTextFields = Object.entries(expected.keys)
    .filter(([, direction]) => direction === "text")
    .map(([field]) => field);

  return expectedTextFields.every((field) => existing.weights?.[field] === 1);
}

function stringifyKeys(keys: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(keys));
}

function normalizeExpireAfterSeconds(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function requireConnectedDb(
  client: MongoDbClient,
): NonNullable<MongoDbClient["db"]> {
  if (client.readyState !== 1 || !client.db) {
    throw new Error("MongoDB client is not connected");
  }

  return client.db;
}

function validateBootstrapCommand(command: MongoBootstrapCommand): void {
  if (command !== "apply" && command !== "status") {
    throw new Error(`Unsupported MongoDB bootstrap command: ${String(command)}`);
  }
}
