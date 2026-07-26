import type { Knex } from "knex";

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
import type { UserRole } from "../users/user.repository.js";
import type {
  AuditAction,
  AuditListFilters,
  AuditLogRecord,
  CreateAuditLogInput,
  IAuditRepository,
} from "./audit.repository.js";

interface AuditLogRow {
  readonly id: string;
  readonly action: AuditAction;
  readonly actor_id: string | null;
  readonly actor_username: string | null;
  readonly actor_role: UserRole | null;
  readonly ip_address: string | null;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly target_name: string | null;
  readonly details: unknown;
  readonly previous_state: unknown | null;
  readonly new_state: unknown | null;
  readonly created_at: Date | string;
  readonly org_id: string;
}

const AUDIT_TABLE = "audit.audit_logs";
const DEFAULT_ORG_ID = "default";

export class PostgresAuditRepository implements IAuditRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IAuditRepository {
    return new PostgresAuditRepository(transaction);
  }

  public async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      action: input.action,
      actor_id: input.actorId ?? null,
      actor_username: input.actorUsername ?? null,
      actor_role: input.actorRole ?? null,
      ip_address: input.ipAddress ?? null,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_name: input.targetName ?? null,
      details: toJsonb(input.details ?? {}),
      previous_state: input.previousState === undefined || input.previousState === null ? null : toJsonb(input.previousState),
      new_state: input.newState === undefined || input.newState === null ? null : toJsonb(input.newState),
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const [row] = await this.db<AuditLogRow>(AUDIT_TABLE).insert(insertable).returning("*");
    return mapAuditLogRow(row);
  }

  public async list(filters: AuditListFilters = {}): Promise<PageResult<AuditLogRecord>> {
    const query = this.baseQuery().orderBy("created_at", "desc").orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.action !== undefined) {
      query.where("action", filters.action);
    }

    if (filters.actorId !== undefined) {
      query.where("actor_id", filters.actorId);
    }

    if (filters.targetType !== undefined) {
      query.where("target_type", ensureNonBlank(filters.targetType, "targetType"));
    }

    if (filters.targetId !== undefined) {
      query.where("target_id", ensureNonBlank(filters.targetId, "targetId"));
    }

    if (filters.createdFrom !== undefined) {
      query.where("created_at", ">=", filters.createdFrom);
    }

    if (filters.createdTo !== undefined) {
      query.where("created_at", "<", filters.createdTo);
    }

    return pageByLimitOffset<AuditLogRow, AuditLogRecord>(query, filters, mapAuditLogRow);
  }

  public async findById(id: string, createdAt?: Date): Promise<AuditLogRecord | null> {
    const query = this.baseQuery().where("id", id);

    if (createdAt !== undefined) {
      query.andWhere("created_at", createdAt);
    }

    const row = await query.first<AuditLogRow>();
    return row ? mapAuditLogRow(row) : null;
  }

  private baseQuery(): Knex.QueryBuilder<AuditLogRow, AuditLogRow[]> {
    return this.db<AuditLogRow>(AUDIT_TABLE).select("*");
  }
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    ipAddress: row.ip_address,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    details: parseJsonObject(row.details),
    previousState: row.previous_state === null ? null : parseJsonObject(row.previous_state),
    newState: row.new_state === null ? null : parseJsonObject(row.new_state),
    createdAt: toRequiredDate(row.created_at),
    orgId: row.org_id,
  };
}
