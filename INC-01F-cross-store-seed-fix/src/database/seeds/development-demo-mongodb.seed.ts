import { createHash } from "node:crypto";

import type {
  CreateAiResultInput,
  IAiResultRepository,
} from "../repositories/mongodb/ai-result.repository.js";
import type {
  CreateNormalizedEventInput,
  INormalizedEventRepository,
} from "../repositories/mongodb/normalized-event.repository.js";

const BASE_TIME = new Date("2026-07-26T05:30:00.000Z");
const DEMO_BATCH_ID = "development-demo-security-events";
const DEMO_MODEL_NAME = "isolation_forest";
const DEMO_MODEL_VERSION = "dev-seed-v1";

export const DEVELOPMENT_DEMO_EVENT_IDS = Object.freeze([
  "mongo-demo-normalized-event-ssh-001",
  "mongo-demo-normalized-event-ssh-002",
  "mongo-demo-normalized-event-ssh-003",
  "mongo-demo-normalized-event-login-001",
] as const);

export interface DevelopmentMongoSeedRepositories {
  readonly normalizedEvents: Pick<
    INormalizedEventRepository,
    "createManyIfAbsent" | "listByEventIds"
  >;
  readonly aiResults: Pick<
    IAiResultRepository,
    "createManyIfAbsent" | "list"
  >;
}

export interface DevelopmentMongoSeedStatus {
  readonly expectedNormalizedEvents: number;
  readonly presentNormalizedEvents: number;
  readonly expectedAiResults: number;
  readonly presentAiResults: number;
  readonly complete: boolean;
}

export interface DevelopmentMongoSeedResult
  extends DevelopmentMongoSeedStatus {
  readonly insertedNormalizedEvents: number;
  readonly existingNormalizedEvents: number;
  readonly insertedAiResults: number;
  readonly existingAiResults: number;
}

/**
 * Reconciles deterministic development fixtures into MongoDB.
 *
 * PostgreSQL development fixtures reference these event IDs. The operation is
 * intentionally idempotent so a rerun repairs a partial cross-store seed after
 * either database was temporarily unavailable.
 */
export async function seedDevelopmentMongoData(
  repositories: DevelopmentMongoSeedRepositories,
  orgId: string,
): Promise<DevelopmentMongoSeedResult> {
  const normalizedOrgId = requireNonBlank(orgId, "orgId");
  const normalizedEvents = buildDevelopmentNormalizedEvents(normalizedOrgId);
  const aiResults = buildDevelopmentAiResults(normalizedOrgId);

  // AI results reference normalized events, so preserve this ordering.
  const normalizedResult = await repositories.normalizedEvents.createManyIfAbsent(
    normalizedEvents,
  );
  const aiResult = await repositories.aiResults.createManyIfAbsent(aiResults);
  const status = await readDevelopmentMongoSeedStatus(
    repositories,
    normalizedOrgId,
  );

  return {
    ...status,
    insertedNormalizedEvents: normalizedResult.insertedCount,
    existingNormalizedEvents: normalizedResult.existingCount,
    insertedAiResults: aiResult.insertedCount,
    existingAiResults: aiResult.existingCount,
  };
}

export async function readDevelopmentMongoSeedStatus(
  repositories: DevelopmentMongoSeedRepositories,
  orgId: string,
): Promise<DevelopmentMongoSeedStatus> {
  const normalizedOrgId = requireNonBlank(orgId, "orgId");
  const [normalizedEvents, aiResults] = await Promise.all([
    repositories.normalizedEvents.listByEventIds(DEVELOPMENT_DEMO_EVENT_IDS),
    repositories.aiResults.list({
      orgId: normalizedOrgId,
      batchId: DEMO_BATCH_ID,
      modelName: DEMO_MODEL_NAME,
      modelVersion: DEMO_MODEL_VERSION,
      limit: 100,
    }),
  ]);

  const presentEventIds = new Set(
    normalizedEvents
      .filter((event) => event.org_id === normalizedOrgId)
      .map((event) => event.event_id),
  );
  const expectedAiEventIds = new Set(
    buildDevelopmentAiResults(normalizedOrgId).map((result) => result.event_id),
  );
  const presentAiEventIds = new Set(
    aiResults.items
      .filter((result) => expectedAiEventIds.has(result.event_id))
      .map((result) => result.event_id),
  );
  const presentNormalizedEvents = DEVELOPMENT_DEMO_EVENT_IDS.filter((eventId) =>
    presentEventIds.has(eventId),
  ).length;
  const presentAiResults = presentAiEventIds.size;

  return {
    expectedNormalizedEvents: DEVELOPMENT_DEMO_EVENT_IDS.length,
    presentNormalizedEvents,
    expectedAiResults: expectedAiEventIds.size,
    presentAiResults,
    complete:
      presentNormalizedEvents === DEVELOPMENT_DEMO_EVENT_IDS.length &&
      presentAiResults === expectedAiEventIds.size,
  };
}

export function buildDevelopmentNormalizedEvents(
  orgId: string,
): readonly CreateNormalizedEventInput[] {
  const normalizedOrgId = requireNonBlank(orgId, "orgId");
  const seededAt = new Date();

  return [
    sshEvent(
      "mongo-demo-normalized-event-ssh-001",
      -25,
      3,
      normalizedOrgId,
      seededAt,
    ),
    sshEvent(
      "mongo-demo-normalized-event-ssh-002",
      -23,
      3,
      normalizedOrgId,
      seededAt,
    ),
    sshEvent(
      "mongo-demo-normalized-event-ssh-003",
      -10,
      4,
      normalizedOrgId,
      seededAt,
    ),
    {
      event_id: "mongo-demo-normalized-event-login-001",
      dedup_hash: deterministicDedupHash(
        "mongo-demo-normalized-event-login-001",
      ),
      class_uid: 3002,
      category_uid: 3,
      severity_id: 4,
      status_id: 1,
      time: offsetMinutes(BASE_TIME, -80),
      message:
        "Successful administrator login outside normal hours from a new source IP",
      src_endpoint: { ip: "203.0.113.44", hostname: "remote-client" },
      dst_endpoint: { ip: "10.0.0.30", hostname: "db-server-03", port: 22 },
      actor: { user: { name: "admin", type: "admin" } },
      device: { hostname: "db-server-03", ip: "10.0.0.30", type: "server" },
      metadata: {
        version: "1.1.0",
        product: { name: "development-demo", vendor_name: "Trivikrama" },
        log_level: "warning",
      },
      features: {
        hour_of_day: 2,
        is_business_hours: 0,
        new_source_ip: 1,
      },
      schema_valid: true,
      validation_errors: [],
      ingestion: {
        batch_id: DEMO_BATCH_ID,
        collector_id: "collector-linux-dmz-01",
        // TTL retention is based on ingestion time, not historical event time.
        ingested_at: seededAt,
      },
      raw_event: { source: "development_seed" },
      org_id: normalizedOrgId,
    },
  ];
}

export function buildDevelopmentAiResults(
  orgId: string,
): readonly CreateAiResultInput[] {
  const normalizedOrgId = requireNonBlank(orgId, "orgId");
  const seededAt = new Date();

  return [
    {
      event_id: "mongo-demo-normalized-event-ssh-003",
      batch_id: DEMO_BATCH_ID,
      model_name: DEMO_MODEL_NAME,
      model_version: DEMO_MODEL_VERSION,
      anomaly_score: 0.89,
      is_anomaly: true,
      confidence: 0.92,
      threat_category: "brute_force",
      threat_confidence: 0.92,
      shap_explanation: {
        base_value: 0.32,
        features: [
          {
            name: "events_per_minute_src_ip",
            value: 45,
            shap_value: 0.28,
          },
          {
            name: "failed_login_count_10min",
            value: 12,
            shap_value: 0.22,
          },
        ],
      },
      input_features: {
        events_per_minute_src_ip: 45,
        failed_login_count_10min: 12,
      },
      processing_time_ms: 8,
      used_fallback: false,
      // AI-result TTL retention is based on processing time.
      created_at: seededAt,
      org_id: normalizedOrgId,
    },
    {
      event_id: "mongo-demo-normalized-event-login-001",
      batch_id: DEMO_BATCH_ID,
      model_name: DEMO_MODEL_NAME,
      model_version: DEMO_MODEL_VERSION,
      anomaly_score: 0.86,
      is_anomaly: true,
      confidence: 0.89,
      threat_category: "unusual_login",
      threat_confidence: 0.89,
      shap_explanation: {
        base_value: 0.27,
        features: [
          { name: "hour_of_day", value: 2, shap_value: 0.19 },
          { name: "new_source_ip", value: 1, shap_value: 0.31 },
        ],
      },
      input_features: { hour_of_day: 2, new_source_ip: 1 },
      processing_time_ms: 7,
      used_fallback: false,
      created_at: seededAt,
      org_id: normalizedOrgId,
    },
  ];
}

function sshEvent(
  eventId: (typeof DEVELOPMENT_DEMO_EVENT_IDS)[number],
  minuteOffset: number,
  severityId: number,
  orgId: string,
  seededAt: Date,
): CreateNormalizedEventInput {
  return {
    event_id: eventId,
    dedup_hash: deterministicDedupHash(eventId),
    class_uid: 3002,
    category_uid: 3,
    severity_id: severityId,
    status_id: 2,
    time: offsetMinutes(BASE_TIME, minuteOffset),
    message: "Failed SSH password for root from 192.168.1.100",
    src_endpoint: { ip: "192.168.1.100", hostname: "attacker-host" },
    dst_endpoint: { ip: "10.0.0.10", hostname: "web-server-01", port: 22 },
    actor: { user: { name: "root", uid: "0" } },
    device: { hostname: "web-server-01", ip: "10.0.0.10", type: "server" },
    metadata: {
      version: "1.1.0",
      product: { name: "development-demo", vendor_name: "Trivikrama" },
      log_level: severityId >= 4 ? "error" : "warning",
    },
    features: {
      events_per_minute_src_ip: severityId >= 4 ? 45 : 10,
      failed_login_count_10min: severityId >= 4 ? 12 : 5,
    },
    schema_valid: true,
    validation_errors: [],
    ingestion: {
      batch_id: DEMO_BATCH_ID,
      collector_id: "collector-linux-dmz-01",
      ingested_at: seededAt,
    },
    raw_event: { source: "development_seed" },
    org_id: orgId,
  };
}

function deterministicDedupHash(eventId: string): string {
  return `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function offsetMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function requireNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}
