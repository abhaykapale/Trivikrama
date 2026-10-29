import {
  ensureNonBlank,
  parseJsonArray,
  toNullableDate,
  toRequiredDate,
  type QueryExecutor,
} from "../../../database/repositories/common/index.js";
import type { Knex } from "knex";
import type {
  IIncidentContextRepository,
  IncidentAssetContextView,
  IncidentContextRepositoryQuery,
  IncidentContextRepositoryResult,
  IncidentEntityHistoryView,
  PreviousIncidentContextView,
} from "../domain/incident-context.contracts.js";
import type { IncidentEntity } from "../domain/incident.contracts.js";

interface PreviousIncidentRow {
  readonly id: string;
  readonly title: string;
  readonly severity: PreviousIncidentContextView["severity"];
  readonly status: PreviousIncidentContextView["status"];
  readonly created_at: Date | string;
}

interface AssetRow {
  readonly name: string;
  readonly asset_type: string;
  readonly ip_address: string | null;
  readonly criticality: number | string;
  readonly owner: string | null;
  readonly department: string | null;
  readonly tags: unknown;
}

interface EntityHistoryRow {
  readonly entity_value: string;
  readonly first_seen_at: Date | string | null;
  readonly incident_count_30d: number | string;
  readonly alert_count_30d: number | string;
}

export class PostgresIncidentContextRepository
  implements IIncidentContextRepository
{
  public constructor(private readonly db: QueryExecutor) {}

  public async getContext(
    input: IncidentContextRepositoryQuery,
  ): Promise<IncidentContextRepositoryResult> {
    const incidentId = ensureNonBlank(input.incidentId, "incidentId");
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const entities = input.entities.map((entity) => ({
      type: entity.type,
      value: ensureNonBlank(entity.value, "entity.value"),
    }));

    const [previousIncidents, assets, history] = await Promise.all([
      this.listPreviousIncidents(
        incidentId,
        orgId,
        entities,
        input.historySince,
        input.previousIncidentLimit,
      ),
      this.listAssets(orgId, entities),
      this.getEntityHistory(orgId, entities, input.historySince),
    ]);

    return {
      previousIncidents,
      assets,
      entityHistory: combineHistoryByValue(entities, history),
    };
  }

  private async listPreviousIncidents(
    incidentId: string,
    orgId: string,
    entities: readonly IncidentEntity[],
    historySince: Date,
    limit: number,
  ): Promise<readonly PreviousIncidentContextView[]> {
    const query = this.db<PreviousIncidentRow>("public.incidents as i")
      .select("i.id", "i.title", "i.severity", "i.status", "i.created_at")
      .where("i.org_id", orgId)
      .whereNot("i.id", incidentId)
      .andWhere("i.created_at", ">=", historySince)
      .andWhere((builder) => applyEntityMatch(builder, entities, "i"))
      .orderBy("i.created_at", "desc")
      .orderBy("i.id", "asc")
      .limit(limit);
    const rows = await query;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      createdAt: toRequiredDate(row.created_at),
    }));
  }

  private async listAssets(
    orgId: string,
    entities: readonly IncidentEntity[],
  ): Promise<readonly IncidentAssetContextView[]> {
    const hostValues = uniqueValues(
      entities,
      new Set(["host", "src_host"]),
    );
    const ipValues = uniqueValues(
      entities,
      new Set(["src_ip", "dst_ip"]),
    );
    if (hostValues.length === 0 && ipValues.length === 0) return [];

    const query = this.db<AssetRow>("public.assets as asset")
      .select(
        "asset.name",
        "asset.asset_type",
        this.db.raw("host(asset.ip_address) as ip_address"),
        "asset.criticality",
        "asset.owner",
        "asset.department",
        "asset.tags",
      )
      .where("asset.org_id", orgId)
      .andWhere("asset.is_active", true)
      .andWhere((builder) => {
        if (hostValues.length > 0) {
          builder.whereRaw("lower(asset.hostname) = ANY(?::text[])", [
            [...hostValues],
          ]);
          builder.orWhereRaw("lower(asset.name) = ANY(?::text[])", [
            [...hostValues],
          ]);
        }
        if (ipValues.length > 0) {
          builder.orWhereRaw("host(asset.ip_address) = ANY(?::text[])", [
            [...ipValues],
          ]);
        }
      })
      .orderBy("asset.criticality", "desc")
      .orderBy("asset.name", "asc")
      .orderBy("asset.id", "asc");
    const rows = await query;

    return rows.map((row) => ({
      name: row.name,
      assetType: row.asset_type,
      ipAddress: row.ip_address,
      criticality: Number(row.criticality),
      owner: row.owner,
      department: row.department,
      tags: parseJsonArray(row.tags),
    }));
  }

  private async getEntityHistory(
    orgId: string,
    entities: readonly IncidentEntity[],
    historySince: Date,
  ): Promise<readonly EntityHistoryRow[]> {
    const valuePlaceholders = entities
      .map(() => "(?::text, ?::text)")
      .join(", ");
    const entityBindings = entities.flatMap((entity) => [
      entity.type,
      entity.value,
    ]);
    const result = (await this.db.raw(
      `
        WITH requested_entities(entity_type, entity_value) AS (
          VALUES ${valuePlaceholders}
        ),
        requested_values AS (
          SELECT DISTINCT entity_value
          FROM requested_entities
        ),
        matching_incidents AS (
          SELECT DISTINCT
            requested.entity_value,
            incident.id AS incident_id,
            incident.created_at,
            COALESCE(incident.first_event_at, incident.created_at) AS first_seen_at
          FROM requested_entities requested
          INNER JOIN public.incidents incident
            ON incident.org_id = ?
           AND (
             incident.entities @> jsonb_build_array(
               jsonb_build_object(
                 'type', requested.entity_type,
                 'value', requested.entity_value
               )
             )
             OR (
               incident.entity_type = requested.entity_type
               AND incident.primary_entity = requested.entity_value
             )
           )
        )
        SELECT
          requested.entity_value,
          MIN(matches.first_seen_at) AS first_seen_at,
          COUNT(DISTINCT matches.incident_id) FILTER (
            WHERE matches.created_at >= ?::timestamptz
          ) AS incident_count_30d,
          COUNT(DISTINCT alert.id) FILTER (
            WHERE alert.created_at >= ?::timestamptz
          ) AS alert_count_30d
        FROM requested_values requested
        LEFT JOIN matching_incidents matches
          ON matches.entity_value = requested.entity_value
        LEFT JOIN public.alerts alert
          ON alert.incident_id = matches.incident_id
         AND alert.org_id = ?
         AND alert.created_at >= ?::timestamptz
        GROUP BY requested.entity_value
        ORDER BY requested.entity_value ASC
      `,
      [
        ...entityBindings,
        orgId,
        historySince,
        historySince,
        orgId,
        historySince,
      ],
    )) as { readonly rows: readonly EntityHistoryRow[] };
    return result.rows;
  }
}

function applyEntityMatch(
  builder: Knex.QueryBuilder,
  entities: readonly IncidentEntity[],
  alias: string,
): void {
  for (const entity of entities) {
    builder.orWhere((nested) => {
      nested
        .whereRaw(`${alias}.entities @> ?::jsonb`, [
          JSON.stringify([{ type: entity.type, value: entity.value }]),
        ])
        .orWhere((primary) => {
          primary
            .where(`${alias}.entity_type`, entity.type)
            .andWhere(`${alias}.primary_entity`, entity.value);
        });
    });
  }
}

function uniqueValues(
  entities: readonly IncidentEntity[],
  types: ReadonlySet<string>,
): readonly string[] {
  return Array.from(
    new Set(
      entities
        .filter((entity) => types.has(entity.type))
        .map((entity) => entity.value.toLowerCase()),
    ),
  );
}

function combineHistoryByValue(
  entities: readonly IncidentEntity[],
  rows: readonly EntityHistoryRow[],
): Readonly<Record<string, IncidentEntityHistoryView>> {
  const result: Record<string, IncidentEntityHistoryView> = {};
  for (const entity of entities) {
    if (result[entity.value] !== undefined) continue;
    const row = rows.find(
      (candidate) => candidate.entity_value === entity.value,
    );
    result[entity.value] = {
      firstSeenAt: row === undefined ? null : toNullableDate(row.first_seen_at),
      incidentCount30d: Number(row?.incident_count_30d ?? 0),
      alertCount30d: Number(row?.alert_count_30d ?? 0),
    };
  }
  return result;
}
