import type { Knex } from "knex";

import {
  ensureNonBlank,
  parseJsonArray,
  parseJsonObject,
  toNullableDate,
  toRequiredDate,
  type QueryExecutor,
} from "../../../database/repositories/common/index.js";
import type {
  GetIncidentQuery,
  IIncidentQueryRepository,
  IncidentQueryPage,
  IncidentQueryRecord,
  IncidentQuerySortField,
  ListIncidentsQuery,
} from "../domain/incident-query.contracts.js";

interface IncidentQueryRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: IncidentQueryRecord["status"];
  readonly severity: IncidentQueryRecord["severity"];
  readonly risk_score: number | string;
  readonly source: IncidentQueryRecord["source"];
  readonly score_breakdown: unknown;
  readonly primary_entity: string | null;
  readonly entity_type: IncidentQueryRecord["entityType"];
  readonly entities: unknown;
  readonly kill_chain_stages: unknown;
  readonly alert_count: number | string;
  readonly event_count: number | string;
  readonly assigned_to: string | null;
  readonly first_event_at: Date | string | null;
  readonly last_event_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly resolved_at: Date | string | null;
  readonly closed_at: Date | string | null;
}

interface CountRow {
  readonly total: number | string;
}

const INCIDENTS_TABLE = "public.incidents";

const SORT_COLUMNS = {
  createdAt: "created_at",
  riskScore: "risk_score",
  severity: "severity",
  alertCount: "alert_count",
  updatedAt: "updated_at",
} as const satisfies Readonly<Record<IncidentQuerySortField, string>>;

export class PostgresIncidentQueryRepository
  implements IIncidentQueryRepository
{
  public constructor(private readonly db: QueryExecutor) {}

  public async list(input: ListIncidentsQuery): Promise<IncidentQueryPage> {
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const offset = (input.page - 1) * input.limit;
    const rowsQuery = this.db<IncidentQueryRow>(INCIDENTS_TABLE).select("*");
    const countQuery = this.db<IncidentQueryRow>(INCIDENTS_TABLE);

    applyFilters(rowsQuery, input, orgId);
    applyFilters(countQuery, input, orgId);

    const sortColumn = SORT_COLUMNS[input.sort];
    rowsQuery
      .orderBy(sortColumn, input.order)
      .orderBy("id", input.order)
      .limit(input.limit)
      .offset(offset);

    const [rows, count] = await Promise.all([
      rowsQuery as Promise<IncidentQueryRow[]>,
      countQuery.count<CountRow>({ total: "*" }).first(),
    ]);

    return {
      items: rows.map(mapIncidentQueryRow),
      total: Number(count?.total ?? 0),
    };
  }

  public async findById(
    input: GetIncidentQuery,
  ): Promise<IncidentQueryRecord | null> {
    const row = await this.db<IncidentQueryRow>(INCIDENTS_TABLE)
      .select("*")
      .where("id", ensureNonBlank(input.incidentId, "incidentId"))
      .andWhere("org_id", ensureNonBlank(input.orgId, "orgId"))
      .first<IncidentQueryRow>();

    return row === undefined ? null : mapIncidentQueryRow(row);
  }
}

function applyFilters(
  query: Knex.QueryBuilder,
  input: ListIncidentsQuery,
  orgId: string,
): void {
  query.where("org_id", orgId);

  if (input.status !== undefined) query.whereIn("status", input.status);
  if (input.severity !== undefined) query.whereIn("severity", input.severity);
  if (input.source !== undefined) query.whereIn("source", input.source);
  if (input.assignedTo !== undefined) {
    query.where("assigned_to", input.assignedTo);
  }
  if (input.createdFrom !== undefined) {
    query.where("created_at", ">=", input.createdFrom);
  }
  if (input.createdTo !== undefined) {
    query.where("created_at", "<=", input.createdTo);
  }
  if (input.search !== undefined) {
    const pattern = `%${escapeLikePattern(input.search)}%`;
    query.andWhere((builder) => {
      builder
        .whereILike("title", pattern)
        .orWhereILike("description", pattern)
        .orWhereILike("primary_entity", pattern);
    });
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function mapIncidentQueryRow(row: IncidentQueryRow): IncidentQueryRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    severity: row.severity,
    riskScore: Number(row.risk_score),
    source: row.source,
    scoreBreakdown: parseJsonObject(row.score_breakdown),
    primaryEntity: row.primary_entity,
    entityType: row.entity_type,
    entities: parseJsonArray(
      row.entities,
    ) as unknown as IncidentQueryRecord["entities"],
    killChainStages: parseJsonArray(
      row.kill_chain_stages,
    ) as unknown as IncidentQueryRecord["killChainStages"],
    alertCount: Number(row.alert_count),
    eventCount: Number(row.event_count),
    assignedTo: row.assigned_to,
    firstEventAt: toNullableDate(row.first_event_at),
    lastEventAt: toNullableDate(row.last_event_at),
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
    resolvedAt: toNullableDate(row.resolved_at),
    closedAt: toNullableDate(row.closed_at),
  };
}
