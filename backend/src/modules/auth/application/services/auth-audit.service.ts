import type {
  AuthAuditAction,
  CreateAuditLogInput,
  IAuditRepository,
  IIdGenerator,
} from "../../domain/auth.contracts.js";
import type { AuthRole } from "../../domain/auth.types.js";
import { isRecord } from "../shared.js";

type AuditActorRole = AuthRole;
type AuditAction = AuthAuditAction;

const AUTH_LOGIN_AUDIT_ACTION = "login" satisfies AuditAction;
const AUTH_LOGOUT_AUDIT_ACTION = "logout" satisfies AuditAction;

const DEFAULT_ORG_ID = "default";
const AUTH_TARGET_TYPE = "user";
const MAX_DETAIL_TEXT_LENGTH = 512;

const SENSITIVE_DETAIL_KEYS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "jwt",
  "authorization",
  "authorizationHeader",
  "authorization_header",
  "cookie",
  "cookies",
  "secret",
  "clientSecret",
  "client_secret",
  "apiKey",
  "api_key",
]);

export type AuthAuditLoginFailureReason =
  | "invalid_credentials"
  | "user_not_found"
  | "user_inactive"
  | "account_locked";

export type AuthAuditRefreshFailureReason =
  | "session_expired"
  | "session_revoked"
  | "token_invalid"
  | "user_inactive"
  | "user_not_found";

export interface AuthAuditActorDto {
  readonly id: string;
  readonly username: string;
  readonly role: AuditActorRole;
}

export interface AuthAuditClientContextDto {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly orgId?: string | null;
}

export interface RecordLoginSuccessInput extends AuthAuditClientContextDto {
  readonly user: AuthAuditActorDto;
}

export interface RecordLoginFailureInput extends AuthAuditClientContextDto {
  readonly username: string;
  readonly reason: AuthAuditLoginFailureReason;
  readonly failedLoginCount?: number;
  readonly userId?: string | null;
  readonly userRole?: AuditActorRole | null;
}

export interface RecordAccountLockedInput extends AuthAuditClientContextDto {
  readonly username: string;
  readonly lockedUntil: string;
  readonly failedLoginCount: number;
  readonly userId?: string | null;
  readonly userRole?: AuditActorRole | null;
}

export interface RecordLogoutInput extends AuthAuditClientContextDto {
  readonly user: AuthAuditActorDto;
}

export interface RecordRefreshSuccessInput extends AuthAuditClientContextDto {
  readonly user: AuthAuditActorDto;
}

export interface RecordRefreshFailureInput extends AuthAuditClientContextDto {
  readonly reason: AuthAuditRefreshFailureReason;
  readonly user?: AuthAuditActorDto | null;
}

interface AuthAuditRecordInput {
  readonly action: AuditAction;
  readonly actorId: string | null;
  readonly actorUsername: string | null;
  readonly actorRole: AuditActorRole | null;
  readonly ipAddress: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly orgId: string;
}

export class AuthAuditService {
  public constructor(
    private readonly auditRepository: IAuditRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  public async recordLoginSuccess(input: RecordLoginSuccessInput): Promise<void> {
    await this.record({
      action: AUTH_LOGIN_AUDIT_ACTION,
      actorId: input.user.id,
      actorUsername: input.user.username,
      actorRole: input.user.role,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: input.user.id,
      targetName: input.user.username,
      details: withClientDetails(input, {
        event: "login_success",
        result: "success",
        authMethod: "password",
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  public async recordLoginFailure(input: RecordLoginFailureInput): Promise<void> {
    const username = normalizeRequiredText(input.username, "username");

    await this.record({
      action: AUTH_LOGIN_AUDIT_ACTION,
      actorId: normalizeOptionalText(input.userId),
      actorUsername: username,
      actorRole: input.userRole ?? null,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: normalizeOptionalText(input.userId),
      targetName: username,
      details: withClientDetails(input, {
        event: "login_failure",
        result: "failure",
        reason: input.reason,
        failedLoginCount: input.failedLoginCount ?? null,
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  public async recordAccountLocked(input: RecordAccountLockedInput): Promise<void> {
    const username = normalizeRequiredText(input.username, "username");

    await this.record({
      action: AUTH_LOGIN_AUDIT_ACTION,
      actorId: normalizeOptionalText(input.userId),
      actorUsername: username,
      actorRole: input.userRole ?? null,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: normalizeOptionalText(input.userId),
      targetName: username,
      details: withClientDetails(input, {
        event: "account_locked",
        result: "account_locked",
        reason: "too_many_failed_attempts",
        failedLoginCount: input.failedLoginCount,
        lockedUntil: input.lockedUntil,
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  public async recordLogout(input: RecordLogoutInput): Promise<void> {
    await this.record({
      action: AUTH_LOGOUT_AUDIT_ACTION,
      actorId: input.user.id,
      actorUsername: input.user.username,
      actorRole: input.user.role,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: input.user.id,
      targetName: input.user.username,
      details: withClientDetails(input, {
        event: "logout",
        result: "success",
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  public async recordRefreshSuccess(input: RecordRefreshSuccessInput): Promise<void> {
    await this.record({
      action: AUTH_LOGIN_AUDIT_ACTION,
      actorId: input.user.id,
      actorUsername: input.user.username,
      actorRole: input.user.role,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: input.user.id,
      targetName: input.user.username,
      details: withClientDetails(input, {
        event: "refresh_success",
        result: "success",
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  public async recordRefreshFailure(
    input: RecordRefreshFailureInput,
  ): Promise<void> {
    await this.record({
      action: AUTH_LOGIN_AUDIT_ACTION,
      actorId: input.user?.id ?? null,
      actorUsername: input.user?.username ?? null,
      actorRole: input.user?.role ?? null,
      ipAddress: normalizeOptionalText(input.ipAddress),
      targetType: AUTH_TARGET_TYPE,
      targetId: input.user?.id ?? null,
      targetName: input.user?.username ?? "auth_refresh",
      details: withClientDetails(input, {
        event: "refresh_failure",
        result: "refresh_failure",
        reason: input.reason,
      }),
      orgId: normalizeOrgId(input.orgId),
    });
  }

  private async record(input: AuthAuditRecordInput): Promise<void> {
    const auditInput: CreateAuditLogInput = {
      id: this.idGenerator.generate(),
      action: input.action,
      actorId: input.actorId,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      ipAddress: input.ipAddress,
      targetType: input.targetType,
      targetId: input.targetId,
      targetName: input.targetName,
      details: sanitizeAuditDetails(input.details),
      orgId: input.orgId,
    };

    try {
      await this.auditRepository.create(auditInput);
    } catch {
      // Audit failures must not break the authentication flow.
      // In production this should be wired to a structured logger.
    }
  }
}

function withClientDetails(
  context: AuthAuditClientContextDto,
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const userAgent = normalizeOptionalText(context.userAgent);

  if (userAgent === null) {
    return sanitizeAuditDetails(details);
  }

  return sanitizeAuditDetails({
    ...details,
    userAgent,
  });
}

function sanitizeAuditDetails(
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = isSensitiveDetailKey(key)
      ? "[REDACTED]"
      : sanitizeAuditValue(value);
  }

  return sanitized;
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return truncateText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (isRecord(value)) {
    return sanitizeAuditDetails(value);
  }

  return truncateText(String(value));
}

function isSensitiveDetailKey(key: string): boolean {
  return SENSITIVE_DETAIL_KEYS.has(key) || SENSITIVE_DETAIL_KEYS.has(key.toLowerCase());
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = normalizeOptionalText(value);

  if (normalized === null) {
    throw new Error(`${fieldName} is required for auth audit logging.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return truncateText(trimmed);
}

function normalizeOrgId(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? DEFAULT_ORG_ID;
}

function truncateText(value: string): string {
  return value.length <= MAX_DETAIL_TEXT_LENGTH
    ? value
    : value.slice(0, MAX_DETAIL_TEXT_LENGTH);
}