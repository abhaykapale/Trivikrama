import {
  ensureNonBlank,
  pageByLimitOffset,
  parseJsonArray,
  parseJsonObject,
  toJsonb,
  toRequiredDate,
  type PageResult,
  type PaginationOptions,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  AlertListFilters,
  AlertRecord,
  CreateAlertInput,
  IAlertRepository,
  UpdateAlertInput,
} from "./alert.repository.js";

interface AlertRow {
  readonly id: string;
  readonly incident_id: string | null;
  readonly alert_type: AlertRecord["alertType"];
  readonly rule_id: string | null;
  readonly rule_name: string | null;
  readonly matched_condition: string | null;
  readonly anomaly_score: number | string | null;
  readonly confidence: number | string | null;
  readonly threat_category: string | null;
  readonly model_version: string | null;
  readonly shap_values: unknown | null;
  readonly severity: AlertRecord["severity"];
  readonly weight: number | string;
  readonly tags: unknown;
  readonly metadata: unknown;
  readonly matched_event_ids: unknown;
  readonly created_at: Date | string;
  readonly org_id: string;
}

const ALERTS_TABLE = "public.alerts";
const DEFAULT_ORG_ID = "default";

export class PostgresAlertRepository implements IAlertRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IAlertRepository {
    return new PostgresAlertRepository(transaction);
  }

  public async create(input: CreateAlertInput): Promise<AlertRecord> {
    const [row] = await this.db<AlertRow>(ALERTS_TABLE).insert(toInsertableAlert(input)).returning("*");
    return mapAlertRow(row);
  }

  public async createMany(inputs: readonly CreateAlertInput[]): Promise<readonly AlertRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    const rows = await this.db<AlertRow>(ALERTS_TABLE)
      .insert(inputs.map(toInsertableAlert))
      .returning("*");

    return rows.map(mapAlertRow);
  }

  public async findById(id: string): Promise<AlertRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<AlertRow>();
    return row ? mapAlertRow(row) : null;
  }

  public async list(filters: AlertListFilters = {}): Promise<PageResult<AlertRecord>> {
    const query = this.baseQuery().orderBy("created_at", "desc").orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.incidentId !== undefined) {
      if (filters.incidentId === null) {
        query.whereNull("incident_id");
      } else {
        query.where("incident_id", ensureNonBlank(filters.incidentId, "incidentId"));
      }
    }

    if (filters.alertType !== undefined) {
      query.where("alert_type", filters.alertType);
    }

    if (filters.ruleId !== undefined) {
      query.where("rule_id", ensureNonBlank(filters.ruleId, "ruleId"));
    }

    if (filters.severity !== undefined) {
      query.where("severity", filters.severity);
    }

    if (filters.createdFrom !== undefined) {
      query.where("created_at", ">=", filters.createdFrom);
    }

    if (filters.createdTo !== undefined) {
      query.where("created_at", "<", filters.createdTo);
    }

    return pageByLimitOffset<AlertRow, AlertRecord>(query, filters, mapAlertRow);
  }

  public async listByIncident(incidentId: string, filters: PaginationOptions = {}): Promise<PageResult<AlertRecord>> {
    return this.list({ ...filters, incidentId });
  }

  public async update(id: string, input: UpdateAlertInput): Promise<AlertRecord | null> {
    const updates: Record<string, unknown> = {};

    if (input.incidentId !== undefined) updates.incident_id = input.incidentId;
    if (input.ruleId !== undefined) updates.rule_id = input.ruleId;
    if (input.ruleName !== undefined) updates.rule_name = input.ruleName;
    if (input.matchedCondition !== undefined) updates.matched_condition = input.matchedCondition;
    if (input.anomalyScore !== undefined) {
      validateProbability(input.anomalyScore, "anomalyScore", true);
      updates.anomaly_score = input.anomalyScore;
    }
    if (input.confidence !== undefined) {
      validateProbability(input.confidence, "confidence", true);
      updates.confidence = input.confidence;
    }
    if (input.threatCategory !== undefined) updates.threat_category = input.threatCategory;
    if (input.modelVersion !== undefined) updates.model_version = input.modelVersion;
    if (input.shapValues !== undefined) updates.shap_values = input.shapValues === null ? null : toJsonb(input.shapValues);
    if (input.severity !== undefined) updates.severity = input.severity;
    if (input.weight !== undefined) {
      validateProbability(input.weight, "weight", false);
      updates.weight = input.weight;
    }
    if (input.tags !== undefined) updates.tags = toJsonb(input.tags);
    if (input.metadata !== undefined) updates.metadata = toJsonb(input.metadata);
    if (input.matchedEventIds !== undefined) updates.matched_event_ids = toJsonb(input.matchedEventIds);

    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }

    const [row] = await this.db<AlertRow>(ALERTS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update(updates)
      .returning("*");

    return row ? mapAlertRow(row) : null;
  }

  private baseQuery() {
    return this.db<AlertRow>(ALERTS_TABLE).select("*");
  }
}

function toInsertableAlert(input: CreateAlertInput): Record<string, unknown> {
  validateProbability(input.anomalyScore ?? null, "anomalyScore", true);
  validateProbability(input.confidence ?? null, "confidence", true);
  validateProbability(input.weight ?? 0.5, "weight", false);

  return {
    ...(input.id ? { id: input.id } : {}),
    incident_id: input.incidentId ?? null,
    alert_type: input.alertType,
    rule_id: input.ruleId ?? null,
    rule_name: input.ruleName ?? null,
    matched_condition: input.matchedCondition ?? null,
    anomaly_score: input.anomalyScore ?? null,
    confidence: input.confidence ?? null,
    threat_category: input.threatCategory ?? null,
    model_version: input.modelVersion ?? null,
    shap_values: input.shapValues === undefined || input.shapValues === null ? null : toJsonb(input.shapValues),
    severity: input.severity ?? "medium",
    weight: input.weight ?? 0.5,
    tags: toJsonb(input.tags ?? []),
    metadata: toJsonb(input.metadata ?? {}),
    matched_event_ids: toJsonb(input.matchedEventIds ?? []),
    org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
  };
}

function validateProbability(value: number | null, fieldName: string, nullable: boolean): void {
  if (value === null && nullable) {
    return;
  }

  if (value === null || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0.00 and 1.00.`);
  }
}

function mapAlertRow(row: AlertRow): AlertRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    alertType: row.alert_type,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    matchedCondition: row.matched_condition,
    anomalyScore: row.anomaly_score === null ? null : Number(row.anomaly_score),
    confidence: row.confidence === null ? null : Number(row.confidence),
    threatCategory: row.threat_category,
    modelVersion: row.model_version,
    shapValues: row.shap_values === null ? null : parseJsonObject(row.shap_values),
    severity: row.severity,
    weight: Number(row.weight),
    tags: parseJsonArray(row.tags),
    metadata: parseJsonObject(row.metadata),
    matchedEventIds: parseJsonArray(row.matched_event_ids),
    createdAt: toRequiredDate(row.created_at),
    orgId: row.org_id,
  };
}
