import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly jwtId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface CreateSessionInput {
  readonly id?: string;
  readonly userId: string;
  readonly jwtId: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly expiresAt: Date;
}

export interface SessionListFilters extends PaginationOptions {
  readonly userId?: string;
  readonly includeRevoked?: boolean;
  readonly activeAt?: Date;
  readonly expiresBefore?: Date;
}

export interface ISessionRepository {
  withTransaction(transaction: TransactionClient): ISessionRepository;
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  findByJwtId(jwtId: string): Promise<SessionRecord | null>;
  list(filters?: SessionListFilters): Promise<PageResult<SessionRecord>>;
  revokeById(id: string, revokedAt?: Date): Promise<SessionRecord | null>;
  revokeByJwtId(jwtId: string, revokedAt?: Date): Promise<SessionRecord | null>;
  revokeAllForUser(userId: string, revokedAt?: Date): Promise<number>;
  deleteExpired(expiredBefore?: Date): Promise<number>;
}
