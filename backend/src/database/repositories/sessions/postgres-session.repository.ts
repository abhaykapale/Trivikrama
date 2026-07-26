import {
  ensureNonBlank,
  pageByLimitOffset,
  toNullableDate,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CreateSessionInput,
  ISessionRepository,
  SessionListFilters,
  SessionRecord,
} from "./session.repository.js";

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly jwt_id: string;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly revoked_at: Date | string | null;
}

const SESSIONS_TABLE = "public.sessions";

export class PostgresSessionRepository implements ISessionRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): ISessionRepository {
    return new PostgresSessionRepository(transaction);
  }

  public async create(input: CreateSessionInput): Promise<SessionRecord> {
    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      user_id: ensureNonBlank(input.userId, "userId"),
      jwt_id: ensureNonBlank(input.jwtId, "jwtId"),
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      expires_at: input.expiresAt,
    };

    const [row] = await this.db<SessionRow>(SESSIONS_TABLE).insert(insertable).returning("*");
    return mapSessionRow(row);
  }

  public async findById(id: string): Promise<SessionRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<SessionRow>();
    return row ? mapSessionRow(row) : null;
  }

  public async findByJwtId(jwtId: string): Promise<SessionRecord | null> {
    const row = await this.baseQuery().where("jwt_id", ensureNonBlank(jwtId, "jwtId")).first<SessionRow>();
    return row ? mapSessionRow(row) : null;
  }

  public async list(filters: SessionListFilters = {}): Promise<PageResult<SessionRecord>> {
    const query = this.baseQuery().orderBy("created_at", "desc").orderBy("id", "asc");

    if (filters.userId !== undefined) {
      query.where("user_id", ensureNonBlank(filters.userId, "userId"));
    }

    if (filters.includeRevoked !== true) {
      query.whereNull("revoked_at");
    }

    if (filters.activeAt !== undefined) {
      query.where("expires_at", ">", filters.activeAt).whereNull("revoked_at");
    }

    if (filters.expiresBefore !== undefined) {
      query.where("expires_at", "<", filters.expiresBefore);
    }

    return pageByLimitOffset<SessionRow, SessionRecord>(query, filters, mapSessionRow);
  }

  public async revokeById(id: string, revokedAt = new Date()): Promise<SessionRecord | null> {
    const [row] = await this.db<SessionRow>(SESSIONS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .whereNull("revoked_at")
      .update({ revoked_at: revokedAt })
      .returning("*");

    return row ? mapSessionRow(row) : null;
  }

  public async revokeByJwtId(jwtId: string, revokedAt = new Date()): Promise<SessionRecord | null> {
    const [row] = await this.db<SessionRow>(SESSIONS_TABLE)
      .where("jwt_id", ensureNonBlank(jwtId, "jwtId"))
      .whereNull("revoked_at")
      .update({ revoked_at: revokedAt })
      .returning("*");

    return row ? mapSessionRow(row) : null;
  }

  public async revokeAllForUser(userId: string, revokedAt = new Date()): Promise<number> {
    return this.db<SessionRow>(SESSIONS_TABLE)
      .where("user_id", ensureNonBlank(userId, "userId"))
      .whereNull("revoked_at")
      .update({ revoked_at: revokedAt });
  }

  public async deleteExpired(expiredBefore = new Date()): Promise<number> {
    return this.db<SessionRow>(SESSIONS_TABLE).where("expires_at", "<", expiredBefore).delete();
  }

  private baseQuery() {
    return this.db<SessionRow>(SESSIONS_TABLE).select("*");
  }
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    jwtId: row.jwt_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: toRequiredDate(row.expires_at),
    createdAt: toRequiredDate(row.created_at),
    revokedAt: toNullableDate(row.revoked_at),
  };
}
