import type { Knex } from "knex";

import {
  ensureNonBlank,
  parseJsonArray,
  toNullableDate,
  toRequiredDate,
  type QueryExecutor,
} from "../../../database/repositories/common/index.js";
import type { RuleSeverity, RuleStatus, RuleType } from "../../../database/repositories/rules/rule.repository.js";
import type {
  GetRuleDetailQuery,
  IRuleQueryRepository,
  ListRulesQuery,
  RuleQueryPage,
  RuleQueryRecord,
  RuleQuerySortField,
} from "../domain/rule-query.contracts.js";

interface RuleQueryRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: RuleStatus;
  readonly type: RuleType;
  readonly severity: RuleSeverity;
  readonly weight: number | string;
  readonly yaml_content: string;
  readonly compiled_hash: string | null;
  readonly class_uid: number | null;
  readonly category_uid: number | null;
  readonly tags: unknown;
  readonly false_positives: unknown;
  readonly rule_references: unknown;
  readonly version: number | string;
  readonly is_builtin: boolean;
  readonly created_by: string | null;
  readonly updated_by: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly alerts_generated: number | string | null;
  readonly last_triggered_at: Date | string | null;
}

interface CountRow {
  readonly total: number | string;
}

const RULES_TABLE = "public.rules as r";

const SORT_COLUMNS = {
  name: "r.name",
  status: "r.status",
  createdAt: "r.created_at",
  updatedAt: "r.updated_at",
} as const satisfies Readonly<Record<Exclude<RuleQuerySortField, "severity">, string>>;

export class PostgresRuleQueryRepository implements IRuleQueryRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public async list(input: ListRulesQuery): Promise<RuleQueryPage> {
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const alertStats = this.alertStats(orgId);
    const rowsQuery = this.db<RuleQueryRow>(RULES_TABLE)
      .select("r.*")
      .select(
        this.db.raw("COALESCE(stats.alerts_generated, 0) AS alerts_generated"),
        "stats.last_triggered_at",
      )
      .leftJoin(alertStats.as("stats"), "stats.rule_id", "r.id");
    const countQuery = this.db<RuleQueryRow>(RULES_TABLE);

    applyFilters(rowsQuery, input, orgId);
    applyFilters(countQuery, input, orgId);
    applySort(rowsQuery, input);
    rowsQuery.limit(input.limit).offset((input.page - 1) * input.limit);

    const [rows, count] = await Promise.all([
      rowsQuery as Promise<RuleQueryRow[]>,
      countQuery.count<CountRow>({ total: "*" }).first(),
    ]);

    return {
      items: rows.map(mapRuleQueryRow),
      total: Number(count?.total ?? 0),
    };
  }

  public async findById(input: GetRuleDetailQuery): Promise<RuleQueryRecord | null> {
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const row = await this.db<RuleQueryRow>(RULES_TABLE)
      .select("r.*")
      .select(
        this.db.raw("COALESCE(stats.alerts_generated, 0) AS alerts_generated"),
        "stats.last_triggered_at",
      )
      .leftJoin(this.alertStats(orgId).as("stats"), "stats.rule_id", "r.id")
      .where("r.org_id", orgId)
      .andWhere("r.id", ensureNonBlank(input.ruleId, "ruleId"))
      .first<RuleQueryRow>();

    return row === undefined ? null : mapRuleQueryRow(row);
  }

  private alertStats(orgId: string): Knex.QueryBuilder {
    return this.db("public.alerts as a")
      .select("a.rule_id")
      .count({ alerts_generated: "*" })
      .max({ last_triggered_at: "a.created_at" })
      .where("a.org_id", orgId)
      .whereNotNull("a.rule_id")
      .groupBy("a.rule_id");
  }
}

function applyFilters(
  query: Knex.QueryBuilder,
  input: ListRulesQuery,
  orgId: string,
): void {
  query.where("r.org_id", orgId);
  if (input.status !== undefined) query.andWhere("r.status", input.status);
  if (input.type !== undefined) query.andWhere("r.type", input.type);
  if (input.severity !== undefined) query.andWhere("r.severity", input.severity);
  if (input.isBuiltin !== undefined) query.andWhere("r.is_builtin", input.isBuiltin);
  if (input.tag !== undefined) {
    query.andWhereRaw("r.tags @> ?::jsonb", [JSON.stringify([input.tag])]);
  }
  if (input.search !== undefined) {
    const pattern = `%${escapeLikePattern(input.search)}%`;
    query.andWhere((builder) => {
      builder
        .whereILike("r.name", pattern)
        .orWhereILike("r.description", pattern)
        .orWhereRaw("r.tags::text ILIKE ?", [pattern]);
    });
  }
}

function applySort(query: Knex.QueryBuilder, input: ListRulesQuery): void {
  if (input.sort === "severity") {
    query.orderByRaw(
      `CASE r.severity
        WHEN 'critical' THEN 5
        WHEN 'high' THEN 4
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 2
        WHEN 'informational' THEN 1
        ELSE 0 END ${input.order}`,
    );
  } else {
    query.orderBy(SORT_COLUMNS[input.sort], input.order);
  }
  query.orderBy("r.id", input.order);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function mapRuleQueryRow(row: RuleQueryRow): RuleQueryRecord {
  const weight = Number(row.weight);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    type: row.type,
    severity: row.severity,
    weight,
    priority: readPriority(row.yaml_content, weight),
    classUid: row.class_uid,
    categoryUid: row.category_uid,
    tags: toStrings(row.tags),
    falsePositives: toStrings(row.false_positives),
    references: toStrings(row.rule_references),
    yamlContent: row.yaml_content,
    compiledHash: row.compiled_hash,
    isBuiltin: row.is_builtin,
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    alertsGenerated: Number(row.alerts_generated ?? 0),
    lastTriggeredAt: toNullableDate(row.last_triggered_at),
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
  };
}

function toStrings(value: unknown): readonly string[] {
  return parseJsonArray(value).filter((entry): entry is string => typeof entry === "string");
}

function readPriority(yamlContent: string, weight: number): number {
  const boundedSource = yamlContent.slice(0, 128 * 1_024);
  const match = /^priority:\s*([0-9]+)\s*(?:#.*)?$/mu.exec(boundedSource);
  if (match?.[1] !== undefined) {
    const priority = Number(match[1]);
    if (Number.isInteger(priority) && priority >= 1 && priority <= 1_000) {
      return priority;
    }
  }
  return Math.max(1, Math.min(1_000, Math.round(weight * 1_000)));
}
