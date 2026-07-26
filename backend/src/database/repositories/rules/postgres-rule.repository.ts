import type { Knex } from "knex";

import {
  ensureNonBlank,
  pageByLimitOffset,
  parseJsonArray,
  toJsonb,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CreateRuleInput,
  IRuleRepository,
  RuleListFilters,
  RuleRecord,
  RuleSeverity,
  RuleStatus,
  RuleType,
  UpdateRuleInput,
} from "./rule.repository.js";

interface RuleRow {
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
  readonly org_id: string;
}

const RULES_TABLE = "public.rules";
const DEFAULT_ORG_ID = "default";

export class PostgresRuleRepository implements IRuleRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IRuleRepository {
    return new PostgresRuleRepository(transaction);
  }

  public async findById(id: string): Promise<RuleRecord | null> {
    const row = await this.baseQuery().where("id", id).first<RuleRow>();
    return row ? mapRuleRow(row) : null;
  }

  public async findByName(name: string, orgId = DEFAULT_ORG_ID): Promise<RuleRecord | null> {
    const row = await this.baseQuery()
      .where("name", ensureNonBlank(name, "name"))
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .first<RuleRow>();

    return row ? mapRuleRow(row) : null;
  }

  public async findActive(orgId = DEFAULT_ORG_ID): Promise<readonly RuleRecord[]> {
    const rows = await this.baseQuery()
      .where("status", "active")
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .orderBy("severity", "asc")
      .orderBy("name", "asc");

    return rows.map(mapRuleRow);
  }

  public async list(filters: RuleListFilters = {}): Promise<PageResult<RuleRecord>> {
    const query = this.baseQuery().orderBy("updated_at", "desc").orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.status !== undefined) {
      query.where("status", filters.status);
    }

    if (filters.type !== undefined) {
      query.where("type", filters.type);
    }

    if (filters.severity !== undefined) {
      query.where("severity", filters.severity);
    }

    if (filters.isBuiltin !== undefined) {
      query.where("is_builtin", filters.isBuiltin);
    }

    if (filters.classUid !== undefined) {
      query.where("class_uid", filters.classUid);
    }

    if (filters.tag !== undefined && filters.tag.trim().length > 0) {
      query.whereRaw("tags @> ?::jsonb", [JSON.stringify([filters.tag.trim()])]);
    }

    if (filters.search !== undefined && filters.search.trim().length > 0) {
      const term = `%${filters.search.trim()}%`;
      query.andWhere((builder: Knex.QueryBuilder) => {
        builder.whereILike("name", term).orWhereILike("description", term);
      });
    }

    return pageByLimitOffset<RuleRow, RuleRecord>(query, filters, mapRuleRow);
  }

  public async create(input: CreateRuleInput): Promise<RuleRecord> {
    validateWeight(input.weight);
    validateVersion(input.version ?? 1);

    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      name: ensureNonBlank(input.name, "name"),
      description: input.description ?? null,
      status: input.status ?? "active",
      type: input.type,
      severity: input.severity,
      weight: input.weight,
      yaml_content: ensureNonBlank(input.yamlContent, "yamlContent"),
      compiled_hash: input.compiledHash ?? null,
      class_uid: input.classUid ?? null,
      category_uid: input.categoryUid ?? null,
      tags: toJsonb(input.tags ?? []),
      false_positives: toJsonb(input.falsePositives ?? []),
      rule_references: toJsonb(input.ruleReferences ?? []),
      version: input.version ?? 1,
      is_builtin: input.isBuiltin ?? false,
      created_by: input.createdBy ?? null,
      updated_by: input.updatedBy ?? input.createdBy ?? null,
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const [row] = await this.db<RuleRow>(RULES_TABLE).insert(insertable).returning("*");
    return mapRuleRow(row);
  }

  public async update(id: string, input: UpdateRuleInput): Promise<RuleRecord | null> {
    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
      patch.name = ensureNonBlank(input.name, "name");
    }

    if (input.description !== undefined) {
      patch.description = input.description;
    }

    if (input.status !== undefined) {
      patch.status = input.status;
    }

    if (input.type !== undefined) {
      patch.type = input.type;
    }

    if (input.severity !== undefined) {
      patch.severity = input.severity;
    }

    if (input.weight !== undefined) {
      validateWeight(input.weight);
      patch.weight = input.weight;
    }

    if (input.yamlContent !== undefined) {
      patch.yaml_content = ensureNonBlank(input.yamlContent, "yamlContent");
    }

    if (input.compiledHash !== undefined) {
      patch.compiled_hash = input.compiledHash;
    }

    if (input.classUid !== undefined) {
      patch.class_uid = input.classUid;
    }

    if (input.categoryUid !== undefined) {
      patch.category_uid = input.categoryUid;
    }

    if (input.tags !== undefined) {
      patch.tags = toJsonb(input.tags);
    }

    if (input.falsePositives !== undefined) {
      patch.false_positives = toJsonb(input.falsePositives);
    }

    if (input.ruleReferences !== undefined) {
      patch.rule_references = toJsonb(input.ruleReferences);
    }

    if (input.version !== undefined) {
      validateVersion(input.version);
      patch.version = input.version;
    }

    if (input.updatedBy !== undefined) {
      patch.updated_by = input.updatedBy;
    }

    if (Object.keys(patch).length === 0) {
      return this.findById(id);
    }

    const [row] = await this.db<RuleRow>(RULES_TABLE)
      .where("id", id)
      .update(patch)
      .returning("*");

    return row ? mapRuleRow(row) : null;
  }

  public async enable(id: string, updatedBy: string | null = null): Promise<RuleRecord | null> {
    return this.update(id, { status: "active", updatedBy });
  }

  public async disable(id: string, updatedBy: string | null = null): Promise<RuleRecord | null> {
    return this.update(id, { status: "disabled", updatedBy });
  }

  public async archive(id: string, updatedBy: string | null = null): Promise<RuleRecord | null> {
    return this.update(id, { status: "archived", updatedBy });
  }

  private baseQuery(): Knex.QueryBuilder<RuleRow, RuleRow[]> {
    return this.db<RuleRow>(RULES_TABLE).select("*");
  }
}

function mapRuleRow(row: RuleRow): RuleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    type: row.type,
    severity: row.severity,
    weight: Number(row.weight),
    yamlContent: row.yaml_content,
    compiledHash: row.compiled_hash,
    classUid: row.class_uid,
    categoryUid: row.category_uid,
    tags: parseJsonArray(row.tags),
    falsePositives: parseJsonArray(row.false_positives),
    ruleReferences: parseJsonArray(row.rule_references),
    version: Number(row.version),
    isBuiltin: row.is_builtin,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
    orgId: row.org_id,
  };
}

function validateWeight(weight: number): void {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error("Rule weight must be between 0 and 1.");
  }
}

function validateVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Rule version must be a positive integer.");
  }
}
