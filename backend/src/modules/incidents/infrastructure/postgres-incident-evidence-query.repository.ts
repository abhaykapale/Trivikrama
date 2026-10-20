import {
  ensureNonBlank,
  parseJsonArray,
  parseJsonObject,
  toRequiredDate,
  type QueryExecutor,
} from "../../../database/repositories/common/index.js";
import type {
  IIncidentEvidenceQueryRepository,
  IncidentAlertQueryPage,
  IncidentAlertView,
  IncidentEventLinkQueryPage,
  ListIncidentAlertsQuery,
  ListIncidentEventsQuery,
} from "../domain/incident-evidence.contracts.js";

interface AlertRow {
  readonly id: string;
  readonly incident_id: string;
  readonly alert_type: IncidentAlertView["alertType"];
  readonly rule_id: string | null;
  readonly rule_name: string | null;
  readonly matched_condition: string | null;
  readonly anomaly_score: number | string | null;
  readonly confidence: number | string | null;
  readonly threat_category: string | null;
  readonly model_version: string | null;
  readonly shap_values: unknown | null;
  readonly severity: IncidentAlertView["severity"];
  readonly weight: number | string;
  readonly tags: unknown;
  readonly matched_event_ids: unknown;
  readonly created_at: Date | string;
}

interface EventLinkRow {
  readonly event_id: string;
  readonly event_time: Date | string;
}

interface CountRow {
  readonly total: number | string;
}

export class PostgresIncidentEvidenceQueryRepository
  implements IIncidentEvidenceQueryRepository
{
  public constructor(private readonly db: QueryExecutor) {}

  public async listAlerts(
    input: ListIncidentAlertsQuery,
  ): Promise<IncidentAlertQueryPage> {
    const incidentId = ensureNonBlank(input.incidentId, "incidentId");
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const offset = (input.page - 1) * input.limit;
    const base = () =>
      this.db("public.alerts as a")
        .innerJoin("public.incidents as i", "i.id", "a.incident_id")
        .where("a.incident_id", incidentId)
        .andWhere("a.org_id", orgId)
        .andWhere("i.org_id", orgId);
    const rowsQuery = base().select("a.*");
    const countQuery = base();

    if (input.type !== undefined) {
      rowsQuery.andWhere("a.alert_type", input.type);
      countQuery.andWhere("a.alert_type", input.type);
    }

    rowsQuery
      .orderBy("a.created_at", "desc")
      .orderBy("a.id", "asc")
      .limit(input.limit)
      .offset(offset);

    const [rows, count] = await Promise.all([
      rowsQuery as Promise<AlertRow[]>,
      countQuery.count<CountRow>({ total: "*" }).first(),
    ]);

    return {
      items: rows.map(mapAlert),
      total: Number(count?.total ?? 0),
    };
  }

  public async listEventLinks(
    input: ListIncidentEventsQuery,
  ): Promise<IncidentEventLinkQueryPage> {
    const incidentId = ensureNonBlank(input.incidentId, "incidentId");
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const offset = (input.page - 1) * input.limit;
    const base = () =>
      this.db("public.incident_events as ie")
        .innerJoin("public.incidents as i", "i.id", "ie.incident_id")
        .where("ie.incident_id", incidentId)
        .andWhere("i.org_id", orgId);
    const rowsQuery = base()
      .select("ie.event_id", "ie.event_time")
      .orderBy("ie.event_time", "asc")
      .orderBy("ie.id", "asc")
      .limit(input.limit)
      .offset(offset);

    const [rows, count] = await Promise.all([
      rowsQuery as Promise<EventLinkRow[]>,
      base().count<CountRow>({ total: "*" }).first(),
    ]);

    return {
      items: rows.map((row) => ({
        eventId: row.event_id,
        eventTime: toRequiredDate(row.event_time),
      })),
      total: Number(count?.total ?? 0),
    };
  }
}

function mapAlert(row: AlertRow): IncidentAlertView {
  return {
    id: row.id,
    incidentId: row.incident_id,
    alertType: row.alert_type,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    matchedCondition: row.matched_condition,
    anomalyScore:
      row.anomaly_score === null ? null : Number(row.anomaly_score),
    confidence: row.confidence === null ? null : Number(row.confidence),
    threatCategory: row.threat_category,
    modelVersion: row.model_version,
    shapValues:
      row.shap_values === null ? null : parseJsonObject(row.shap_values),
    severity: row.severity,
    weight: Number(row.weight),
    tags: parseJsonArray(row.tags),
    matchedEventIds: parseJsonArray(row.matched_event_ids),
    createdAt: toRequiredDate(row.created_at),
  };
}
