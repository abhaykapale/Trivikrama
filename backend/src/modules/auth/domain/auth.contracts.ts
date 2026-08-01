import type {
  AuthRole,
  AuthSession,
  JwtClaims,
  SessionValidationResult,
} from "./auth.types.js";

// ─── Repository Record Types ───────────────────────────────────────────────
// These types mirror the shapes produced by the database layer so that
// infrastructure implementations satisfy the domain contract via structural
// typing — no adapter required.

export interface UserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AuthRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

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

export type AuthAuditAction = "login" | "login_failed" | "logout" | "session_revoked";

export interface CreateAuditLogInput {
  readonly id?: string;
  readonly action: AuthAuditAction;
  readonly actorId?: string | null;
  readonly actorUsername?: string | null;
  readonly actorRole?: AuthRole | null;
  readonly ipAddress?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly targetName?: string | null;
  readonly details?: Record<string, unknown>;
  readonly previousState?: Record<string, unknown> | null;
  readonly newState?: Record<string, unknown> | null;
  readonly orgId?: string;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly action: AuthAuditAction;
  readonly actorId: string | null;
  readonly actorUsername: string | null;
  readonly actorRole: AuthRole | null;
  readonly ipAddress: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly details: Record<string, unknown>;
  readonly previousState: Record<string, unknown> | null;
  readonly newState: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly orgId: string;
}

// ─── Repository Contracts ──────────────────────────────────────────────────

export interface IUserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByUsername(username: string, orgId?: string): Promise<UserRecord | null>;
  findByUsernameAndOrg(
    username: string,
    orgId: string,
  ): Promise<UserRecord | null>;
  findByEmail(email: string, orgId?: string): Promise<UserRecord | null>;
  create(input: {
    readonly id?: string;
    readonly username: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly role: AuthRole;
    readonly displayName?: string | null;
    readonly isActive?: boolean;
    readonly orgId?: string;
  }): Promise<UserRecord>;
  update(
    id: string,
    input: {
      readonly email?: string;
      readonly passwordHash?: string;
      readonly role?: AuthRole;
      readonly displayName?: string | null;
      readonly isActive?: boolean;
      readonly failedLoginCount?: number;
      readonly lockedUntil?: Date | null;
      readonly lastLoginAt?: Date | null;

    },
  ): Promise<UserRecord | null>;
  incrementFailedLoginCount(id: string): Promise<UserRecord | null>;
  resetLoginFailures(id: string): Promise<UserRecord | null>;
  markLastLogin(id: string, loginAt?: Date): Promise<UserRecord | null>;
  lockUserUntil(id: string, lockedUntil: Date): Promise<UserRecord | null>;
  recordSuccessfulLogin(id: string, loginAt?: Date): Promise<UserRecord | null>;
  deactivate(id: string): Promise<UserRecord | null>;
}

export interface ISessionRepository {
  create(input: {
    readonly id?: string;
    readonly userId: string;
    readonly jwtId: string;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
    readonly expiresAt: Date;
  }): Promise<SessionRecord>;
  createSession(input: {
    readonly id?: string;
    readonly userId: string;
    readonly jwtId: string;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
    readonly expiresAt: Date;
  }): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  findByJwtId(jwtId: string): Promise<SessionRecord | null>;
  findActiveByJwtId(
    jwtId: string,
    activeAt?: Date,
  ): Promise<SessionRecord | null>;
  revokeById(id: string, revokedAt?: Date): Promise<SessionRecord | null>;
  revokeByJwtId(
    jwtId: string,
    revokedAt?: Date,
  ): Promise<SessionRecord | null>;
  rotateJwtId(
    oldJwtId: string,
    newJwtId: string,
    activeAt?: Date,
  ): Promise<SessionRecord | null>;
  revokeAllForUser(userId: string, revokedAt?: Date): Promise<number>;
  deleteExpired(expiredBefore?: Date): Promise<number>;
}

export interface IAuditRepository {
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
}

export interface IUnitOfWork {
  execute<TResult>(
    operation: (context: {
      readonly transaction: unknown;
      readonly repositories: unknown;
      readonly attempt: number;
    }) => Promise<TResult>,
    options?: {
      readonly isolationLevel?: string;
      readonly readOnly?: boolean;
      readonly statementTimeoutMs?: number;
      readonly lockTimeoutMs?: number;
    },
  ): Promise<TResult>;
}

// ─── Service Contracts ─────────────────────────────────────────────────────

export interface IPasswordService {
  verify(plainTextPassword: string, passwordHash: string): Promise<boolean>;
  hash(plainTextPassword: string): Promise<string>;
}

export interface IJwtService {
  sign(claims: JwtClaims): Promise<string>;
  verify(token: string): Promise<JwtClaims>;
}

/** The generic token port name is retained as an alias to the JWT contract. */
export type ITokenService = IJwtService;

export interface ISessionCache {
  get(jwtId: string): Promise<AuthSession | null>;
  set(session: AuthSession, ttlSeconds: number): Promise<void>;
  delete(jwtId: string): Promise<void>;
}

export interface IClock {
  now(): Date;
}

export interface IIdGenerator {
  generate(): string;
}

export interface ISessionValidator {
  validate(jwtId: string): Promise<SessionValidationResult>;
}

/** Existing contract names retained as aliases for later implementations. */
export type PasswordVerifier = Pick<IPasswordService, "verify">;
export type PasswordHasher = Pick<IPasswordService, "hash">;
export type TokenSigner = Pick<IJwtService, "sign">;
export type TokenVerifier = Pick<IJwtService, "verify">;
export type SessionValidator = ISessionValidator;
