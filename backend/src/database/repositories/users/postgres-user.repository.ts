import type { Knex } from "knex";

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
  CreateUserInput,
  IUserRepository,
  UpdateUserInput,
  UserListFilters,
  UserRecord,
  UserRole,
} from "./user.repository.js";

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: UserRole;
  readonly display_name: string | null;
  readonly is_active: boolean;
  readonly last_login_at: Date | string | null;
  readonly failed_login_count: number | string;
  readonly locked_until: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly org_id: string;
}

const USERS_TABLE = "public.users";
const DEFAULT_ORG_ID = "default";

export class PostgresUserRepository implements IUserRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IUserRepository {
    return new PostgresUserRepository(transaction);
  }

  public async findById(id: string): Promise<UserRecord | null> {
    const row = await this.baseQuery().where("id", id).first<UserRow>();
    return row ? mapUserRow(row) : null;
  }

  public async findByUsername(
    username: string,
    orgId = DEFAULT_ORG_ID,
  ): Promise<UserRecord | null> {
    return this.findByUsernameAndOrg(username, orgId);
  }

  public async findByUsernameAndOrg(
    username: string,
    orgId: string,
  ): Promise<UserRecord | null> {
    const row = await this.baseQuery()
      .where("username", ensureNonBlank(username, "username"))
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .first<UserRow>();

    return row ? mapUserRow(row) : null;
  }

  public async findByEmail(email: string, orgId = DEFAULT_ORG_ID): Promise<UserRecord | null> {
    const row = await this.baseQuery()
      .where("email", ensureNonBlank(email, "email"))
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .first<UserRow>();

    return row ? mapUserRow(row) : null;
  }

  public async list(filters: UserListFilters = {}): Promise<PageResult<UserRecord>> {
    const query = this.baseQuery().orderBy("created_at", "desc").orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.role !== undefined) {
      query.where("role", filters.role);
    }

    if (filters.isActive !== undefined) {
      query.where("is_active", filters.isActive);
    }

    if (filters.search !== undefined && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`;
      query.andWhere((builder: Knex.QueryBuilder) => {
        builder
          .whereILike("username", term)
          .orWhereILike("email", term)
          .orWhereILike("display_name", term);
      });
    }

    return pageByLimitOffset<UserRow, UserRecord>(query, filters, mapUserRow);
  }

  public async create(input: CreateUserInput): Promise<UserRecord> {
    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      username: ensureNonBlank(input.username, "username"),
      email: ensureNonBlank(input.email, "email"),
      password_hash: ensureNonBlank(input.passwordHash, "passwordHash"),
      role: input.role,
      display_name: input.displayName ?? null,
      is_active: input.isActive ?? true,
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const [row] = await this.db<UserRow>(USERS_TABLE).insert(insertable).returning("*");
    return mapUserRow(row);
  }

  public async update(id: string, input: UpdateUserInput): Promise<UserRecord | null> {
    const patch: Record<string, unknown> = {};

    if (input.email !== undefined) {
      patch.email = ensureNonBlank(input.email, "email");
    }

    if (input.passwordHash !== undefined) {
      patch.password_hash = ensureNonBlank(input.passwordHash, "passwordHash");
    }

    if (input.role !== undefined) {
      patch.role = input.role;
    }

    if (input.displayName !== undefined) {
      patch.display_name = input.displayName;
    }

    if (input.isActive !== undefined) {
      patch.is_active = input.isActive;
    }

    if (input.failedLoginCount !== undefined) {
      if (!Number.isInteger(input.failedLoginCount) || input.failedLoginCount < 0) {
        throw new Error("failedLoginCount must be a non-negative integer.");
      }
      patch.failed_login_count = input.failedLoginCount;
    }

    if (input.lockedUntil !== undefined) {
      patch.locked_until = input.lockedUntil;
    }

    if (input.lastLoginAt !== undefined) {
      patch.last_login_at = input.lastLoginAt;
    }

    if (Object.keys(patch).length === 0) {
      return this.findById(id);
    }

    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", id)
      .update(patch)
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async incrementFailedLoginCount(
    id: string,
  ): Promise<UserRecord | null> {
    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({
        failed_login_count: this.db.raw("failed_login_count + 1"),
      })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async resetLoginFailures(id: string): Promise<UserRecord | null> {
    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({
        failed_login_count: 0,
        locked_until: null,
      })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async markLastLogin(
    id: string,
    loginAt = new Date(),
  ): Promise<UserRecord | null> {
    assertValidDate(loginAt, "loginAt");

    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({ last_login_at: loginAt })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async lockUserUntil(
    id: string,
    lockedUntil: Date,
  ): Promise<UserRecord | null> {
    assertValidDate(lockedUntil, "lockedUntil");

    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({ locked_until: lockedUntil })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async recordSuccessfulLogin(
    id: string,
    loginAt = new Date(),
  ): Promise<UserRecord | null> {
    assertValidDate(loginAt, "loginAt");

    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({
        last_login_at: loginAt,
        failed_login_count: 0,
        locked_until: null,
      })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async recordFailedLogin(
    id: string,
    failedLoginCount: number,
    lockedUntil: Date | null = null,
  ): Promise<UserRecord | null> {
    if (!Number.isInteger(failedLoginCount) || failedLoginCount < 0) {
      throw new Error("failedLoginCount must be a non-negative integer.");
    }

    if (lockedUntil !== null) {
      assertValidDate(lockedUntil, "lockedUntil");
    }

    const [row] = await this.db<UserRow>(USERS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({
        failed_login_count: this.db.raw("failed_login_count + 1"),
        locked_until: lockedUntil,
      })
      .returning("*");

    return row ? mapUserRow(row) : null;
  }

  public async deactivate(id: string): Promise<UserRecord | null> {
    return this.update(id, { isActive: false });
  }

  private baseQuery(): Knex.QueryBuilder<UserRow, UserRow[]> {
    return this.db<UserRow>(USERS_TABLE).select("*");
  }
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    displayName: row.display_name,
    isActive: row.is_active,
    lastLoginAt: toNullableDate(row.last_login_at),
    failedLoginCount: Number(row.failed_login_count),
    lockedUntil: toNullableDate(row.locked_until),
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
    orgId: row.org_id,
  };
}

function assertValidDate(value: Date, fieldName: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date.`);
  }
}
