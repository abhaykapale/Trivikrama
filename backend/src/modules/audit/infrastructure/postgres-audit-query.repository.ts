import type { Knex } from "knex";
import { ensureNonBlank, parseJsonObject, toRequiredDate, type QueryExecutor } from "../../../database/repositories/common/index.js";
import type { UserRole } from "../../../database/repositories/users/user.repository.js";
import type {
  AuditLogInvestigationView,
  AuditQueryAction,
  AuditQuerySortField,
  AuditRepositoryPage,
  AuditRepositoryQuery,
  IAuditQueryRepository,
} from "../domain/audit-query.contracts.js";

interface AuditQueryRow {
  readonly id: string;
  readonly action: AuditQueryAction;
  readonly actor_id: string | null;
  readonly actor_username: string | null;
  readonly actor_role: UserRole | null;
  readonly ip_address: string | null;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly target_name: string | null;
  readonly details: unknown;
  readonly created_at: Date | string;
}

const SORT_COLUMNS: Record<AuditQuerySortField, string> = {
  createdAt: "created_at",
  action: "action",
  actorUsername: "actor_username",
  targetType: "target_type",
};

export class PostgresAuditQueryRepository implements IAuditQueryRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public async list(input: AuditRepositoryQuery): Promise<AuditRepositoryPage> {
    validateQuery(input);
    const predicates = ["org_id = ?", "created_at >= ?", "created_at <= ?"];
    const bindings: Knex.RawBinding[] = [ensureNonBlank(input.orgId, "orgId"), input.from, input.to];
    addFilter(predicates, bindings, "action", input.action);
    addFilter(predicates, bindings, "actor_id", input.actorId);
    addFilter(predicates, bindings, "target_type", input.targetType);
    addFilter(predicates, bindings, "target_id", input.targetId);
    addFilter(predicates, bindings, "ip_address", input.ipAddress);

    const where = predicates.join(" AND ");
    const direction = input.order === "asc" ? "ASC" : "DESC";
    const sortColumn = SORT_COLUMNS[input.sort];
    const secondary = sortColumn === "created_at" ? "" : ", created_at DESC";
    const [rowsResult, countResult] = await Promise.all([
      this.db.raw(
        `SELECT id, action, actor_id, actor_username, actor_role, ip_address,
                target_type, target_id, target_name, details, created_at
           FROM audit.audit_logs
          WHERE ${where}
          ORDER BY ${sortColumn} ${direction} NULLS LAST${secondary}, id ASC
          LIMIT ? OFFSET ?`,
        [...bindings, input.limit, input.offset],
      ),
      this.db.raw(
        `SELECT COUNT(*) AS total FROM audit.audit_logs WHERE ${where}`,
        bindings,
      ),
    ]);
    return {
      items: (rowsResult.rows as AuditQueryRow[]).map(toView),
      total: Number((countResult.rows[0] as { readonly total: string | number }).total),
    };
  }
}

function addFilter(predicates: string[], bindings: Knex.RawBinding[], column: string, value: string | undefined): void {
  if (value === undefined) return;
  predicates.push(`${column} = ?`);
  bindings.push(value);
}

function validateQuery(input: AuditRepositoryQuery): void {
  ensureNonBlank(input.orgId, "orgId");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("limit must be between 1 and 100");
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error("offset must be a non-negative safe integer");
  if (input.from.getTime() > input.to.getTime()) throw new Error("from must be earlier than or equal to to");
}

function toView(row: AuditQueryRow): AuditLogInvestigationView {
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
    createdAt: toRequiredDate(row.created_at),
  };
}
