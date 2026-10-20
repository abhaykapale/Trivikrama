import type { Knex } from "knex";

import {
  ensureNonBlank,
  parseJsonObject,
  toJsonb,
  toNullableDate,
  toRequiredDate,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  ClaimIncidentNotificationsInput,
  EnqueueIncidentNotificationInput,
  EnqueueIncidentNotificationResult,
  FailIncidentNotificationInput,
  IIncidentNotificationOutboxRepository,
  IncidentNotificationChannel,
  IncidentNotificationOutboxCounts,
  IncidentNotificationOutboxRecord,
  IncidentNotificationOutboxStatus,
  IncidentNotificationPayload,
  IncidentNotificationType,
} from "./incident-notification-outbox.repository.js";

interface IncidentNotificationOutboxRow {
  readonly id: string;
  readonly org_id: string;
  readonly incident_id: string;
  readonly event_type: IncidentNotificationType;
  readonly channel: IncidentNotificationChannel;
  readonly deduplication_key: string;
  readonly payload: unknown;
  readonly status: IncidentNotificationOutboxStatus;
  readonly attempt_count: number | string;
  readonly available_at: Date | string;
  readonly locked_at: Date | string | null;
  readonly locked_until: Date | string | null;
  readonly lock_owner: string | null;
  readonly published_at: Date | string | null;
  readonly last_error: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const TABLE = "public.incident_notification_outbox";

export class PostgresIncidentNotificationOutboxRepository
  implements IIncidentNotificationOutboxRepository
{
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(
    transaction: TransactionClient,
  ): IIncidentNotificationOutboxRepository {
    return new PostgresIncidentNotificationOutboxRepository(transaction);
  }

  public async enqueueIfAbsent(
    input: EnqueueIncidentNotificationInput,
  ): Promise<EnqueueIncidentNotificationResult> {
    validatePayloadEnvelope(input);
    const insertable = {
      id: ensureNonBlank(input.id, "id"),
      org_id: ensureNonBlank(input.orgId, "orgId"),
      incident_id: ensureNonBlank(input.incidentId, "incidentId"),
      event_type: input.eventType,
      channel: input.channel,
      deduplication_key: ensureNonBlank(input.deduplicationKey, "deduplicationKey"),
      payload: toJsonb(input.payload),
      available_at: input.availableAt ?? new Date(),
    };

    const rows = await this.db<IncidentNotificationOutboxRow>(TABLE)
      .insert(insertable)
      .onConflict("deduplication_key")
      .ignore()
      .returning("*");

    if (rows.length > 0) {
      return { record: mapRow(rows[0]!), inserted: true };
    }

    const existing = await this.findByDeduplicationKey(input.deduplicationKey);
    if (existing === null) {
      throw new Error("Incident notification outbox conflict could not be resolved.");
    }
    return { record: existing, inserted: false };
  }

  public async findById(id: string): Promise<IncidentNotificationOutboxRecord | null> {
    const row = await this.baseQuery()
      .where("id", ensureNonBlank(id, "id"))
      .first<IncidentNotificationOutboxRow>();
    return row ? mapRow(row) : null;
  }

  public async findByDeduplicationKey(
    deduplicationKey: string,
  ): Promise<IncidentNotificationOutboxRecord | null> {
    const row = await this.baseQuery()
      .where("deduplication_key", ensureNonBlank(deduplicationKey, "deduplicationKey"))
      .first<IncidentNotificationOutboxRow>();
    return row ? mapRow(row) : null;
  }

  public async findLatestByIncident(
    incidentId: string,
    orgId: string,
  ): Promise<IncidentNotificationOutboxRecord | null> {
    const row = await this.baseQuery()
      .where({
        incident_id: ensureNonBlank(incidentId, "incidentId"),
        org_id: ensureNonBlank(orgId, "orgId"),
      })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .first<IncidentNotificationOutboxRow>();
    return row ? mapRow(row) : null;
  }

  public async claimBatch(
    input: ClaimIncidentNotificationsInput,
  ): Promise<readonly IncidentNotificationOutboxRecord[]> {
    validateClaim(input);
    const result = await this.db.raw<{ rows: IncidentNotificationOutboxRow[] }>(
      `
        WITH candidates AS (
          SELECT id
          FROM public.incident_notification_outbox
          WHERE status = 'pending'
            AND available_at <= ?
            AND (locked_until IS NULL OR locked_until <= ?)
          ORDER BY available_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ?
        )
        UPDATE public.incident_notification_outbox AS outbox
        SET locked_at = ?,
            locked_until = ?,
            lock_owner = ?,
            updated_at = ?
        FROM candidates
        WHERE outbox.id = candidates.id
        RETURNING outbox.*
      `,
      [
        input.now,
        input.now,
        input.limit,
        input.now,
        input.lockedUntil,
        input.owner,
        input.now,
      ],
    );
    return Object.freeze(result.rows.map(mapRow));
  }

  public async markPublished(
    id: string,
    owner: string,
    publishedAt: Date,
  ): Promise<IncidentNotificationOutboxRecord | null> {
    const rows = await this.db<IncidentNotificationOutboxRow>(TABLE)
      .where({
        id: ensureNonBlank(id, "id"),
        lock_owner: ensureNonBlank(owner, "owner"),
        status: "pending",
      })
      .update({
        status: "published",
        attempt_count: this.db.raw("attempt_count + 1"),
        published_at: publishedAt,
        locked_at: null,
        locked_until: null,
        lock_owner: null,
        last_error: null,
        updated_at: publishedAt,
      })
      .returning("*");
    return rows[0] ? mapRow(rows[0]) : null;
  }

  public async markFailed(
    id: string,
    input: FailIncidentNotificationInput,
  ): Promise<IncidentNotificationOutboxRecord | null> {
    const rows = await this.db<IncidentNotificationOutboxRow>(TABLE)
      .where({
        id: ensureNonBlank(id, "id"),
        lock_owner: ensureNonBlank(input.owner, "owner"),
        status: "pending",
      })
      .update({
        status: input.deadLetter ? "dead_letter" : "pending",
        attempt_count: this.db.raw("attempt_count + 1"),
        available_at: input.nextAvailableAt,
        locked_at: null,
        locked_until: null,
        lock_owner: null,
        last_error: ensureNonBlank(input.error, "error").slice(0, 1000),
        updated_at: input.now,
      })
      .returning("*");
    return rows[0] ? mapRow(rows[0]) : null;
  }

  public async countByStatus(): Promise<IncidentNotificationOutboxCounts> {
    const rows = await this.db<IncidentNotificationOutboxRow>(TABLE)
      .select("status")
      .count<{ status: IncidentNotificationOutboxStatus; count: string }[]>("* as count")
      .groupBy("status");
    const counts = { pending: 0, published: 0, deadLetter: 0 };
    for (const row of rows) {
      if (row.status === "pending") counts.pending = Number(row.count);
      else if (row.status === "published") counts.published = Number(row.count);
      else counts.deadLetter = Number(row.count);
    }
    return Object.freeze(counts);
  }

  private baseQuery(): Knex.QueryBuilder<
    IncidentNotificationOutboxRow,
    IncidentNotificationOutboxRow[]
  > {
    return this.db<IncidentNotificationOutboxRow>(TABLE).select("*");
  }
}

function validateClaim(input: ClaimIncidentNotificationsInput): void {
  ensureNonBlank(input.owner, "owner");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new Error("Incident notification claim limit must be between 1 and 500.");
  }
  if (input.lockedUntil.getTime() <= input.now.getTime()) {
    throw new Error("Incident notification lock must expire after the claim time.");
  }
}

function mapRow(row: IncidentNotificationOutboxRow): IncidentNotificationOutboxRecord {
  const payload = parsePayload(row);
  return Object.freeze({
    id: row.id,
    orgId: row.org_id,
    incidentId: row.incident_id,
    eventType: row.event_type,
    channel: row.channel,
    deduplicationKey: row.deduplication_key,
    payload: Object.freeze({ ...payload, data: Object.freeze({ ...payload.data }) }),
    status: row.status,
    attemptCount: Number(row.attempt_count),
    availableAt: toRequiredDate(row.available_at),
    lockedAt: toNullableDate(row.locked_at),
    lockedUntil: toNullableDate(row.locked_until),
    lockOwner: row.lock_owner,
    publishedAt: toNullableDate(row.published_at),
    lastError: row.last_error,
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
  });
}

function validatePayloadEnvelope(input: EnqueueIncidentNotificationInput): void {
  if (
    input.payload.id !== input.id ||
    input.payload.type !== input.eventType ||
    input.payload.orgId !== input.orgId ||
    input.payload.data.incidentId !== input.incidentId
  ) {
    throw new Error("Incident notification payload does not match its outbox envelope.");
  }
  if (!Number.isFinite(Date.parse(input.payload.occurredAt))) {
    throw new Error("Incident notification occurredAt must be an ISO timestamp.");
  }
}

function parsePayload(row: IncidentNotificationOutboxRow): IncidentNotificationPayload {
  const payload = parseJsonObject(row.payload);
  const data = parseJsonObject(payload.data);
  if (
    payload.id !== row.id ||
    payload.type !== row.event_type ||
    payload.orgId !== row.org_id ||
    data.incidentId !== row.incident_id ||
    typeof payload.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(payload.occurredAt))
  ) {
    throw new Error(`Incident notification outbox payload ${row.id} is invalid.`);
  }
  return Object.freeze({
    id: payload.id,
    type: payload.type,
    occurredAt: payload.occurredAt,
    orgId: payload.orgId,
    data: Object.freeze(data),
  }) as IncidentNotificationPayload;
}
