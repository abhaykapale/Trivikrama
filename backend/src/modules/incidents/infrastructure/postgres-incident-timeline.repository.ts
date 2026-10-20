import {
  ensureNonBlank,
  toRequiredDate,
  type QueryExecutor,
} from "../../../database/repositories/common/index.js";
import type {
  GetIncidentTimelineQuery,
  IIncidentTimelineRepository,
  IncidentTimelinePage,
  IncidentTimelineStoredEntry,
} from "../domain/incident-timeline.contracts.js";
import type { IncidentSeverity } from "../domain/incident.contracts.js";

interface TimelineRow {
  readonly timeline_id: string;
  readonly entry_type: "event" | "alert" | "action";
  readonly occurred_at: Date | string;
  readonly event_id: string | null;
  readonly event_class_uid: number | null;
  readonly event_severity: number | null;
  readonly alert_id: string | null;
  readonly alert_type: "rule" | "ai" | null;
  readonly alert_severity: IncidentSeverity | null;
  readonly alert_title: string | null;
  readonly anomaly_score: number | string | null;
  readonly action_name: string | null;
  readonly actor_id: string | null;
  readonly actor_name: string | null;
  readonly previous_value: string | null;
  readonly new_value: string | null;
  readonly note_content: string | null;
}

interface CountRow {
  readonly total: number | string;
}

const TIMELINE_CTE = `
  WITH timeline AS (
    SELECT
      'event:' || ie.id::text AS timeline_id,
      'event'::text AS entry_type,
      ie.event_time AS occurred_at,
      ie.event_id,
      ie.class_uid AS event_class_uid,
      ie.severity_id AS event_severity,
      NULL::text AS alert_id,
      NULL::text AS alert_type,
      NULL::text AS alert_severity,
      NULL::text AS alert_title,
      NULL::numeric AS anomaly_score,
      NULL::text AS action_name,
      NULL::text AS actor_id,
      NULL::text AS actor_name,
      NULL::text AS previous_value,
      NULL::text AS new_value,
      NULL::text AS note_content,
      0 AS type_order
    FROM public.incident_events ie
    INNER JOIN public.incidents i ON i.id = ie.incident_id
    WHERE ie.incident_id = ?::uuid AND i.org_id = ?

    UNION ALL

    SELECT
      'alert:' || a.id::text,
      'alert'::text,
      a.created_at,
      NULL::text,
      NULL::integer,
      NULL::integer,
      a.id::text,
      a.alert_type::text,
      a.severity::text,
      COALESCE(a.rule_name, a.threat_category, 'AI Anomaly'),
      a.anomaly_score,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      1
    FROM public.alerts a
    INNER JOIN public.incidents i ON i.id = a.incident_id
    WHERE a.incident_id = ?::uuid AND i.org_id = ? AND a.org_id = ?

    UNION ALL

    SELECT
      'action:' || log.id::text,
      'action'::text,
      log.created_at,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::numeric,
      CASE log.action::text
        WHEN 'incident_create' THEN 'created'
        WHEN 'incident_status_change' THEN 'status_change'
        WHEN 'incident_assign' THEN 'assigned'
        WHEN 'incident_note_added' THEN 'note_added'
        ELSE 'updated'
      END,
      COALESCE(log.actor_id::text, 'system'),
      COALESCE(log.actor_username, 'System'),
      CASE log.action::text
        WHEN 'incident_status_change' THEN log.previous_state ->> 'status'
        WHEN 'incident_assign' THEN COALESCE(
          log.previous_state ->> 'assignedTo',
          log.previous_state ->> 'assigned_to'
        )
        ELSE NULL
      END,
      CASE log.action::text
        WHEN 'incident_create' THEN log.new_state ->> 'status'
        WHEN 'incident_status_change' THEN log.new_state ->> 'status'
        WHEN 'incident_assign' THEN COALESCE(
          log.new_state ->> 'assignedTo',
          log.new_state ->> 'assigned_to'
        )
        ELSE NULL
      END,
      CASE WHEN log.action::text = 'incident_note_added'
        THEN log.details ->> 'content'
        ELSE NULL
      END,
      2
    FROM audit.audit_logs log
    INNER JOIN public.incidents i ON i.id::text = log.target_id
    WHERE log.target_type = 'incident'
      AND log.target_id = ?
      AND i.org_id = ?
      AND log.org_id = ?
  )
`;

export class PostgresIncidentTimelineRepository
  implements IIncidentTimelineRepository
{
  public constructor(private readonly db: QueryExecutor) {}

  public async list(
    input: GetIncidentTimelineQuery,
  ): Promise<IncidentTimelinePage> {
    const incidentId = ensureNonBlank(input.incidentId, "incidentId");
    const orgId = ensureNonBlank(input.orgId, "orgId");
    const baseBindings = [
      incidentId,
      orgId,
      incidentId,
      orgId,
      orgId,
      incidentId,
      orgId,
      orgId,
    ];
    const filterBindings = [
      input.type ?? null,
      input.type ?? null,
      input.from ?? null,
      input.from ?? null,
      input.to ?? null,
      input.to ?? null,
    ];
    const filterSql = `
      WHERE (?::text IS NULL OR entry_type = ?::text)
        AND (?::timestamptz IS NULL OR occurred_at >= ?::timestamptz)
        AND (?::timestamptz IS NULL OR occurred_at <= ?::timestamptz)
    `;
    const offset = (input.page - 1) * input.limit;

    const [rowsResult, countResult] = await Promise.all([
      this.db.raw(
        `${TIMELINE_CTE}
         SELECT * FROM timeline
         ${filterSql}
         ORDER BY occurred_at ASC, type_order ASC, timeline_id ASC
         LIMIT ? OFFSET ?`,
        [...baseBindings, ...filterBindings, input.limit, offset],
      ) as Promise<{ readonly rows: readonly TimelineRow[] }>,
      this.db.raw(
        `${TIMELINE_CTE}
         SELECT COUNT(*) AS total FROM timeline
         ${filterSql}`,
        [...baseBindings, ...filterBindings],
      ) as Promise<{ readonly rows: readonly CountRow[] }>,
    ]);

    return {
      items: rowsResult.rows.map(mapTimelineRow),
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }
}

function mapTimelineRow(row: TimelineRow): IncidentTimelineStoredEntry {
  const timestamp = toRequiredDate(row.occurred_at);

  if (row.entry_type === "event") {
    return {
      id: row.timeline_id,
      type: "event",
      timestamp,
      eventId: required(row.event_id, "event_id"),
      eventClassUid: row.event_class_uid,
      eventSeverity: row.event_severity,
    };
  }

  if (row.entry_type === "alert") {
    return {
      id: row.timeline_id,
      type: "alert",
      timestamp,
      alertId: required(row.alert_id, "alert_id"),
      alertType: required(row.alert_type, "alert_type"),
      alertSeverity: required(row.alert_severity, "alert_severity"),
      alertTitle: required(row.alert_title, "alert_title"),
      anomalyScore:
        row.anomaly_score === null ? null : Number(row.anomaly_score),
    };
  }

  return {
    id: row.timeline_id,
    type: "action",
    timestamp,
    action: required(row.action_name, "action_name"),
    actorId: required(row.actor_id, "actor_id"),
    actorName: required(row.actor_name, "actor_name"),
    previousValue: row.previous_value,
    newValue: row.new_value,
    noteContent: row.note_content,
  };
}

function required<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw new Error(`Incident timeline row is missing ${fieldName}.`);
  }
  return value;
}
