import type { UserRole } from "../../../database/repositories/users/user.repository.js";

export const AUDIT_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "session_revoked",
  "incident_create",
  "incident_update",
  "incident_status_change",
  "incident_assign",
  "incident_note_added",
  "incident_resolve",
  "rule_create",
  "rule_update",
  "rule_delete",
  "rule_enable",
  "rule_disable",
  "rule_import",
  "asset_create",
  "asset_update",
  "asset_delete",
  "user_create",
  "user_update",
  "user_password_reset",
  "user_delete",
  "config_change",
  "collector_config_change",
] as const;

export type AuditQueryAction = (typeof AUDIT_ACTIONS)[number];
export type AuditQuerySortField = "createdAt" | "action" | "actorUsername" | "targetType";
export type AuditQuerySortOrder = "asc" | "desc";

export interface ListAuditLogsInput {
  readonly orgId: string;
  readonly action?: AuditQueryAction;
  readonly actorId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly ipAddress?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly limit: number;
  readonly sort: AuditQuerySortField;
  readonly order: AuditQuerySortOrder;
}

export interface AuditRepositoryQuery extends Omit<ListAuditLogsInput, "from" | "to"> {
  readonly from: Date;
  readonly to: Date;
  readonly offset: number;
}

export interface AuditLogInvestigationView {
  readonly id: string;
  readonly action: AuditQueryAction;
  readonly actorId: string | null;
  readonly actorUsername: string | null;
  readonly actorRole: UserRole | null;
  readonly ipAddress: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface AuditRepositoryPage {
  readonly items: readonly AuditLogInvestigationView[];
  readonly total: number;
}

export interface AuditPaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface ListAuditLogsResult {
  readonly data: readonly AuditLogInvestigationView[];
  readonly pagination: AuditPaginationView;
}

export interface IAuditQueryRepository {
  list(input: AuditRepositoryQuery): Promise<AuditRepositoryPage>;
}

export interface AuditQueryClock { now(): Date; }
export const auditQuerySystemClock: AuditQueryClock = { now: () => new Date() };

export const AUDIT_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const AUDIT_MAX_WINDOW_MS = 732 * 24 * 60 * 60 * 1_000;

export class InvalidAuditTimeRangeError extends Error {
  public readonly code = "INVALID_AUDIT_TIME_RANGE" as const;
  public constructor(public readonly reason: "inverted" | "too_large") {
    super(reason === "inverted"
      ? "from must be earlier than or equal to to"
      : "Audit investigation ranges cannot exceed the two-year retention window.");
    this.name = "InvalidAuditTimeRangeError";
  }
}
