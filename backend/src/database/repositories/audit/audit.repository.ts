import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";
import type { UserRole } from "../users/user.repository.js";

export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "session_revoked"
  | "incident_create"
  | "incident_update"
  | "incident_status_change"
  | "incident_assign"
  | "rule_create"
  | "rule_update"
  | "rule_delete"
  | "rule_enable"
  | "rule_disable"
  | "rule_import"
  | "user_create"
  | "user_update"
  | "user_delete"
  | "config_change"
  | "collector_config_change";

export interface AuditLogRecord {
  readonly id: string;
  readonly action: AuditAction;
  readonly actorId: string | null;
  readonly actorUsername: string | null;
  readonly actorRole: UserRole | null;
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

export interface CreateAuditLogInput {
  readonly id?: string;
  readonly action: AuditAction;
  readonly actorId?: string | null;
  readonly actorUsername?: string | null;
  readonly actorRole?: UserRole | null;
  readonly ipAddress?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly targetName?: string | null;
  readonly details?: Record<string, unknown>;
  readonly previousState?: Record<string, unknown> | null;
  readonly newState?: Record<string, unknown> | null;
  readonly orgId?: string;
}

export interface AuditListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly action?: AuditAction;
  readonly actorId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export interface IAuditRepository {
  withTransaction(transaction: TransactionClient): IAuditRepository;
  create(input: CreateAuditLogInput): Promise<AuditLogRecord>;
  list(filters?: AuditListFilters): Promise<PageResult<AuditLogRecord>>;
  findById(id: string, createdAt?: Date): Promise<AuditLogRecord | null>;
}
