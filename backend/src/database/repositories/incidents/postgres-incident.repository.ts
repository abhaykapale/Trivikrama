import type { Knex } from "knex";

import {
  ensureNonBlank,
  pageByLimitOffset,
  parseJsonArray,
  parseJsonObject,
  toNullableDate,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CreateIncidentInput,
  IIncidentRepository,
  IncidentListFilters,
  IncidentRecord,
  IncidentStatus,
  IncidentStatusTransitionInput,
  UpdateIncidentInput,
} from "./incident.repository.js";

interface IncidentRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: IncidentRecord["status"];
  readonly severity: IncidentRecord["severity"];
  readonly risk_score: number | string;
  readonly source: IncidentRecord["source"];
  readonly score_breakdown: unknown;
  readonly primary_entity: string | null;
  readonly entity_type: string | null;
  readonly entities: unknown;
  readonly kill_chain_stages: unknown;
  readonly alert_count: number;
  readonly event_count: number;
  readonly assigned_to: string | null;
  readonly first_event_at: Date | string | null;
  readonly last_event_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly resolved_at: Date | string | null;
  readonly closed_at: Date | string | null;
  readonly org_id: string;
}

const INCIDENTS_TABLE = "public.incidents";
const DEFAULT_ORG_ID = "default";

export class PostgresIncidentRepository implements IIncidentRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IIncidentRepository {
    return new PostgresIncidentRepository(transaction);
  }

  public async create(input: CreateIncidentInput): Promise<IncidentRecord> {
    validateRiskScore(input.riskScore ?? 0);
    validateNonNegativeInteger(input.alertCount ?? 0, "alertCount");
    validateNonNegativeInteger(input.eventCount ?? 0, "eventCount");

    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      title: ensureNonBlank(input.title, "title"),
      description: input.description ?? null,
      status: input.status ?? "open",
      severity: input.severity ?? "medium",
      risk_score: input.riskScore ?? 0,
      source: input.source ?? "rule",
      score_breakdown: input.scoreBreakdown ?? {},
      primary_entity: input.primaryEntity ?? null,
      entity_type: input.entityType ?? null,
      entities: input.entities ?? [],
      kill_chain_stages: input.killChainStages ?? [],
      alert_count: input.alertCount ?? 0,
      event_count: input.eventCount ?? 0,
      assigned_to: input.assignedTo ?? null,
      first_event_at: input.firstEventAt ?? null,
      last_event_at: input.lastEventAt ?? null,
      resolved_at: input.resolvedAt ?? null,
      closed_at: input.closedAt ?? null,
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const [row] = await this.db<IncidentRow>(INCIDENTS_TABLE).insert(insertable).returning("*");
    return mapIncidentRow(row);
  }

  public async findById(id: string): Promise<IncidentRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<IncidentRow>();
    return row ? mapIncidentRow(row) : null;
  }

  public async list(filters: IncidentListFilters = {}): Promise<PageResult<IncidentRecord>> {
    const query = this.baseQuery()
      .orderBy("risk_score", "desc")
      .orderBy("created_at", "desc")
      .orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    applyScalarOrArrayFilter(query, "status", filters.status);
    applyScalarOrArrayFilter(query, "severity", filters.severity);
    applyScalarOrArrayFilter(query, "source", filters.source);

    if (filters.assignedTo !== undefined) {
      if (filters.assignedTo === null) {
        query.whereNull("assigned_to");
      } else {
        query.where("assigned_to", ensureNonBlank(filters.assignedTo, "assignedTo"));
      }
    }

    if (filters.primaryEntity !== undefined) {
      query.where("primary_entity", ensureNonBlank(filters.primaryEntity, "primaryEntity"));
    }

    if (filters.entityType !== undefined) {
      query.where("entity_type", ensureNonBlank(filters.entityType, "entityType"));
    }

    if (filters.minRiskScore !== undefined) {
      validateRiskScore(filters.minRiskScore);
      query.where("risk_score", ">=", filters.minRiskScore);
    }

    if (filters.createdFrom !== undefined) {
      query.where("created_at", ">=", filters.createdFrom);
    }

    if (filters.createdTo !== undefined) {
      query.where("created_at", "<", filters.createdTo);
    }

    if (filters.search !== undefined) {
      const search = `%${ensureNonBlank(filters.search, "search")}%`;
      query.andWhere((builder) => {
        builder
          .whereILike("title", search)
          .orWhereILike("description", search)
          .orWhereILike("primary_entity", search);
      });
    }

    return pageByLimitOffset<IncidentRow, IncidentRecord>(query, filters, mapIncidentRow);
  }

  public async update(id: string, input: UpdateIncidentInput): Promise<IncidentRecord | null> {
    const updates: Record<string, unknown> = {};

    if (input.title !== undefined) updates.title = ensureNonBlank(input.title, "title");
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;
    if (input.severity !== undefined) updates.severity = input.severity;
    if (input.riskScore !== undefined) {
      validateRiskScore(input.riskScore);
      updates.risk_score = input.riskScore;
    }
    if (input.source !== undefined) updates.source = input.source;
    if (input.scoreBreakdown !== undefined) updates.score_breakdown = input.scoreBreakdown;
    if (input.primaryEntity !== undefined) updates.primary_entity = input.primaryEntity;
    if (input.entityType !== undefined) updates.entity_type = input.entityType;
    if (input.entities !== undefined) updates.entities = input.entities;
    if (input.killChainStages !== undefined) updates.kill_chain_stages = input.killChainStages;
    if (input.alertCount !== undefined) {
      validateNonNegativeInteger(input.alertCount, "alertCount");
      updates.alert_count = input.alertCount;
    }
    if (input.eventCount !== undefined) {
      validateNonNegativeInteger(input.eventCount, "eventCount");
      updates.event_count = input.eventCount;
    }
    if (input.assignedTo !== undefined) updates.assigned_to = input.assignedTo;
    if (input.firstEventAt !== undefined) updates.first_event_at = input.firstEventAt;
    if (input.lastEventAt !== undefined) updates.last_event_at = input.lastEventAt;
    if (input.resolvedAt !== undefined) updates.resolved_at = input.resolvedAt;
    if (input.closedAt !== undefined) updates.closed_at = input.closedAt;

    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }

    const [row] = await this.db<IncidentRow>(INCIDENTS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update(updates)
      .returning("*");

    return row ? mapIncidentRow(row) : null;
  }

  public async assign(id: string, assignedTo: string | null): Promise<IncidentRecord | null> {
    return this.update(id, { assignedTo });
  }

  public async transitionStatus(id: string, input: IncidentStatusTransitionInput): Promise<IncidentRecord | null> {
    const now = new Date();
    const updates: UpdateIncidentInput = {
      status: input.status,
      resolvedAt: resolveResolvedAt(input.status, input.resolvedAt, now),
      closedAt: resolveClosedAt(input.status, input.closedAt, now),
    };

    return this.update(id, updates);
  }

  private baseQuery() {
    return this.db<IncidentRow>(INCIDENTS_TABLE).select("*");
  }
}

function applyScalarOrArrayFilter<TValue extends string>(
  query: Knex.QueryBuilder,
  column: string,
  value: TValue | readonly TValue[] | undefined,
): void {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 0) {
      query.whereIn(column, value);
    }
    return;
  }

  query.where(column, value);
}

function resolveResolvedAt(status: IncidentStatus, explicitValue: Date | null | undefined, now: Date): Date | null {
  if (explicitValue !== undefined) {
    return explicitValue;
  }

  return status === "resolved" || status === "closed" ? now : null;
}

function resolveClosedAt(status: IncidentStatus, explicitValue: Date | null | undefined, now: Date): Date | null {
  if (explicitValue !== undefined) {
    return explicitValue;
  }

  return status === "closed" ? now : null;
}

function validateRiskScore(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("riskScore must be between 0.00 and 100.00.");
  }
}

function validateNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
}

function mapIncidentRow(row: IncidentRow): IncidentRecord {
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
    entities: parseJsonArray(row.entities),
    killChainStages: parseJsonArray(row.kill_chain_stages),
    alertCount: Number(row.alert_count),
    eventCount: Number(row.event_count),
    assignedTo: row.assigned_to,
    firstEventAt: toNullableDate(row.first_event_at),
    lastEventAt: toNullableDate(row.last_event_at),
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
    resolvedAt: toNullableDate(row.resolved_at),
    closedAt: toNullableDate(row.closed_at),
    orgId: row.org_id,
  };
}
