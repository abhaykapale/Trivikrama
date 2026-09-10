import {
  ensureNonBlank,
  pageByLimitOffset,
  parseJsonObject,
  toJsonb,
  toNullableDate,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CollectorStatusListFilters,
  CollectorStatusRecord,
  CollectorStatusValue,
  ICollectorStatusRepository,
  UpsertCollectorStatusInput,
} from "./collector-status.repository.js";

interface CollectorStatusRow {
  readonly id: string;
  readonly collector_id: string;
  readonly status: CollectorStatusValue;
  readonly last_heartbeat_at: Date | string | null;
  readonly heartbeat_data: unknown;
  readonly files_processed: number | string;
  readonly events_collected: number | string;
  readonly events_dropped: number | string;
  readonly errors_count: number | string;
  readonly cpu_percent: number | string | null;
  readonly memory_mb: number | string | null;
  readonly first_seen_at: Date | string;
  readonly updated_at: Date | string;
  readonly org_id: string;
}

const COLLECTOR_STATUS_TABLE = "monitor.collector_status";
const DEFAULT_ORG_ID = "default";

export class PostgresCollectorStatusRepository implements ICollectorStatusRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): ICollectorStatusRepository {
    return new PostgresCollectorStatusRepository(transaction);
  }

  public async findById(id: string): Promise<CollectorStatusRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<CollectorStatusRow>();
    return row ? mapCollectorStatusRow(row) : null;
  }

  public async findByCollectorId(collectorId: string): Promise<CollectorStatusRecord | null> {
    const row = await this.baseQuery()
      .where("collector_id", ensureNonBlank(collectorId, "collectorId"))
      .first<CollectorStatusRow>();

    return row ? mapCollectorStatusRow(row) : null;
  }

  public async list(filters: CollectorStatusListFilters = {}): Promise<PageResult<CollectorStatusRecord>> {
    const query = this.baseQuery().orderBy("updated_at", "desc").orderBy("collector_id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.status !== undefined) {
      query.where("status", filters.status);
    }

    if (filters.staleBefore !== undefined) {
      query.where((builder) => {
        builder.whereNull("last_heartbeat_at").orWhere("last_heartbeat_at", "<", filters.staleBefore as Date);
      });
    }

    if (filters.search !== undefined) {
      query.whereILike("collector_id", `%${ensureNonBlank(filters.search, "search")}%`);
    }

    return pageByLimitOffset<CollectorStatusRow, CollectorStatusRecord>(query, filters, mapCollectorStatusRow);
  }

  public async upsertHeartbeat(input: UpsertCollectorStatusInput): Promise<CollectorStatusRecord> {
    validateNonNegative(input.filesProcessed ?? 0, "filesProcessed");
    validateNonNegative(input.eventsCollected ?? 0, "eventsCollected");
    validateNonNegative(input.eventsDropped ?? 0, "eventsDropped");
    validateNonNegative(input.errorsCount ?? 0, "errorsCount");
    validateOptionalNonNegative(input.memoryMb ?? null, "memoryMb");
    validateOptionalCpu(input.cpuPercent ?? null);

    const lastHeartbeatAt = input.lastHeartbeatAt ?? new Date();
    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      collector_id: ensureNonBlank(input.collectorId, "collectorId"),
      status: input.status,
      last_heartbeat_at: lastHeartbeatAt,
      heartbeat_data: toJsonb(input.heartbeatData ?? {}),
      files_processed: input.filesProcessed ?? 0,
      events_collected: input.eventsCollected ?? 0,
      events_dropped: input.eventsDropped ?? 0,
      errors_count: input.errorsCount ?? 0,
      cpu_percent: input.cpuPercent ?? null,
      memory_mb: input.memoryMb ?? null,
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const updates = {
      status: insertable.status,
      last_heartbeat_at: insertable.last_heartbeat_at,
      ...(input.heartbeatData !== undefined
        ? { heartbeat_data: insertable.heartbeat_data }
        : {}),
      ...(input.filesProcessed !== undefined
        ? { files_processed: insertable.files_processed }
        : {}),
      ...(input.eventsCollected !== undefined
        ? { events_collected: insertable.events_collected }
        : {}),
      ...(input.eventsDropped !== undefined
        ? { events_dropped: insertable.events_dropped }
        : {}),
      ...(input.errorsCount !== undefined
        ? { errors_count: insertable.errors_count }
        : {}),
      ...(input.cpuPercent !== undefined
        ? { cpu_percent: insertable.cpu_percent }
        : {}),
      ...(input.memoryMb !== undefined
        ? { memory_mb: insertable.memory_mb }
        : {}),
      ...(input.orgId !== undefined ? { org_id: insertable.org_id } : {}),
    };

    const [row] = await this.db<CollectorStatusRow>(COLLECTOR_STATUS_TABLE)
      .insert(insertable)
      .onConflict("collector_id")
      .merge(updates)
      .whereRaw(
        '"collector_status"."last_heartbeat_at" IS NULL OR EXCLUDED."last_heartbeat_at" >= "collector_status"."last_heartbeat_at"',
      )
      .returning("*");

    if (row !== undefined) {
      return mapCollectorStatusRow(row);
    }

    const existing = await this.findByCollectorId(insertable.collector_id);

    if (existing === null) {
      throw new Error("Collector heartbeat upsert completed without returning a record.");
    }

    return existing;
  }

  public async markOffline(collectorId: string): Promise<CollectorStatusRecord | null> {
    const [row] = await this.db<CollectorStatusRow>(COLLECTOR_STATUS_TABLE)
      .where("collector_id", ensureNonBlank(collectorId, "collectorId"))
      .update({ status: "offline" })
      .returning("*");

    return row ? mapCollectorStatusRow(row) : null;
  }

  public async markStaleOffline(staleBefore: Date, orgId?: string): Promise<number> {
    if (!Number.isFinite(staleBefore.getTime())) {
      throw new Error("staleBefore must be a valid date.");
    }

    const query = this.db<CollectorStatusRow>(COLLECTOR_STATUS_TABLE)
      .whereIn("status", ["online", "degraded"])
      .whereNotNull("last_heartbeat_at")
      .where("last_heartbeat_at", "<", staleBefore);

    if (orgId !== undefined) {
      query.where("org_id", ensureNonBlank(orgId, "orgId"));
    }

    const updated = await query.update({ status: "offline" });

    return Number(updated);
  }

  private baseQuery() {
    return this.db<CollectorStatusRow>(COLLECTOR_STATUS_TABLE).select("*");
  }
}

function validateNonNegative(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be non-negative.`);
  }
}

function validateOptionalNonNegative(value: number | null, fieldName: string): void {
  if (value !== null) {
    validateNonNegative(value, fieldName);
  }
}

function validateOptionalCpu(value: number | null): void {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error("cpuPercent must be between 0.00 and 100.00.");
  }
}

function mapCollectorStatusRow(row: CollectorStatusRow): CollectorStatusRecord {
  return {
    id: row.id,
    collectorId: row.collector_id,
    status: row.status,
    lastHeartbeatAt: toNullableDate(row.last_heartbeat_at),
    heartbeatData: parseJsonObject(row.heartbeat_data),
    filesProcessed: Number(row.files_processed),
    eventsCollected: Number(row.events_collected),
    eventsDropped: Number(row.events_dropped),
    errorsCount: Number(row.errors_count),
    cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
    memoryMb: row.memory_mb === null ? null : Number(row.memory_mb),
    firstSeenAt: toRequiredDate(row.first_seen_at),
    updatedAt: toRequiredDate(row.updated_at),
    orgId: row.org_id,
  };
}
