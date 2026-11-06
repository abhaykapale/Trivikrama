import type { QueryExecutor } from "../../../database/repositories/common/index.js";
import { ensureNonBlank, toRequiredDate } from "../../../database/repositories/common/index.js";
import type {
  DashboardAlertMetrics,
  DashboardIncidentMetrics,
  DashboardTimelineRow,
  DashboardTopAssetRow,
  DashboardWindow,
  IDashboardPostgresRepository,
} from "../domain/dashboard.contracts.js";

interface IncidentMetricsRow {
  readonly open_count: string | number;
  readonly previous_open_count: string | number;
  readonly critical_count: string | number;
  readonly previous_critical_count: string | number;
  readonly investigating_count: string | number;
  readonly resolved_count: string | number;
  readonly closed_count: string | number;
  readonly severity_critical: string | number;
  readonly severity_high: string | number;
  readonly severity_medium: string | number;
  readonly severity_low: string | number;
  readonly severity_informational: string | number;
  readonly avg_response_minutes: string | number | null;
  readonly previous_avg_response_minutes: string | number | null;
  readonly median_response_minutes: string | number | null;
}
interface AlertMetricsRow { readonly total: string | number; readonly previous_total: string | number; readonly rule_alerts: string | number; readonly ai_alerts: string | number; }
interface TimelineDbRow { readonly timestamp: Date | string; readonly severity: DashboardTimelineRow["severity"]; readonly count: string | number; }
interface TopAssetDbRow { readonly entity: string; readonly entity_type: string; readonly incident_count: string | number; readonly critical_count: string | number; readonly high_count: string | number; readonly latest_incident_at: Date | string; }

export class PostgresDashboardRepository implements IDashboardPostgresRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public async getIncidentMetrics(orgId: string, window: DashboardWindow): Promise<DashboardIncidentMetrics> {
    const result = await this.db.raw(
      `SELECT
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND status = 'open') AS previous_open_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'critical') AS previous_critical_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND status = 'investigating') AS investigating_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND status = 'resolved') AS resolved_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND status = 'closed') AS closed_count,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'critical') AS severity_critical,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'high') AS severity_high,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'medium') AS severity_medium,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'low') AS severity_low,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND severity = 'informational') AS severity_informational,
        COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0) FILTER (WHERE created_at >= ? AND created_at < ? AND resolved_at IS NOT NULL), 0) AS avg_response_minutes,
        COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0) FILTER (WHERE created_at >= ? AND created_at < ? AND resolved_at IS NOT NULL), 0) AS previous_avg_response_minutes,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0) FILTER (WHERE created_at >= ? AND created_at < ? AND resolved_at IS NOT NULL), 0) AS median_response_minutes
      FROM public.incidents
      WHERE org_id = ?
        AND created_at >= ?
        AND created_at < ?`,
      [
        window.from, window.to, window.previousFrom, window.from,
        window.from, window.to, window.previousFrom, window.from,
        window.from, window.to, window.from, window.to, window.from, window.to,
        window.from, window.to, window.from, window.to, window.from, window.to,
        window.from, window.to, window.from, window.to, window.from, window.to,
        window.previousFrom, window.from, window.from, window.to,
        ensureNonBlank(orgId, "orgId"), window.previousFrom, window.to,
      ],
    );
    const row = result.rows[0] as IncidentMetricsRow;
    return {
      open: numeric(row.open_count), previousOpen: numeric(row.previous_open_count),
      critical: numeric(row.critical_count), previousCritical: numeric(row.previous_critical_count),
      investigating: numeric(row.investigating_count), resolved: numeric(row.resolved_count), closed: numeric(row.closed_count),
      severity: { critical: numeric(row.severity_critical), high: numeric(row.severity_high), medium: numeric(row.severity_medium), low: numeric(row.severity_low), informational: numeric(row.severity_informational) },
      averageResponseMinutes: numeric(row.avg_response_minutes), previousAverageResponseMinutes: numeric(row.previous_avg_response_minutes), medianResponseMinutes: numeric(row.median_response_minutes),
    };
  }

  public async getAlertMetrics(orgId: string, window: DashboardWindow): Promise<DashboardAlertMetrics> {
    const result = await this.db.raw(
      `SELECT
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS total,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS previous_total,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND alert_type = 'rule') AS rule_alerts,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ? AND alert_type = 'ai') AS ai_alerts
      FROM public.alerts
      WHERE org_id = ? AND created_at >= ? AND created_at < ?`,
      [window.from, window.to, window.previousFrom, window.from, window.from, window.to, window.from, window.to, ensureNonBlank(orgId, "orgId"), window.previousFrom, window.to],
    );
    const row = result.rows[0] as AlertMetricsRow;
    return { total: numeric(row.total), previousTotal: numeric(row.previous_total), ruleAlerts: numeric(row.rule_alerts), aiAlerts: numeric(row.ai_alerts) };
  }

  public async getTimeline(orgId: string, window: DashboardWindow, intervalSeconds: number): Promise<readonly DashboardTimelineRow[]> {
    requireInterval(intervalSeconds);
    const result = await this.db.raw(
      `SELECT
        to_timestamp(floor(extract(epoch FROM created_at) / ?) * ?) AS timestamp,
        severity,
        COUNT(*) AS count
      FROM public.incidents
      WHERE org_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY timestamp, severity
      ORDER BY timestamp ASC, severity ASC`,
      [intervalSeconds, intervalSeconds, ensureNonBlank(orgId, "orgId"), window.from, window.to],
    );
    return (result.rows as TimelineDbRow[]).map((row) => ({ timestamp: toRequiredDate(row.timestamp), severity: row.severity, count: numeric(row.count) }));
  }

  public async getTopAssets(orgId: string, window: DashboardWindow, limit: number): Promise<readonly DashboardTopAssetRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("dashboard asset limit must be between 1 and 25");
    const result = await this.db.raw(
      `SELECT
        primary_entity AS entity,
        entity_type,
        COUNT(*) AS incident_count,
        COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
        MAX(created_at) AS latest_incident_at
      FROM public.incidents
      WHERE org_id = ? AND created_at >= ? AND created_at < ?
        AND primary_entity IS NOT NULL AND entity_type IS NOT NULL
      GROUP BY primary_entity, entity_type
      ORDER BY incident_count DESC, latest_incident_at DESC, entity ASC, entity_type ASC
      LIMIT ?`,
      [ensureNonBlank(orgId, "orgId"), window.from, window.to, limit],
    );
    return (result.rows as TopAssetDbRow[]).map((row) => ({
      entity: row.entity, entityType: row.entity_type, incidentCount: numeric(row.incident_count),
      criticalCount: numeric(row.critical_count), highCount: numeric(row.high_count), latestIncidentAt: toRequiredDate(row.latest_incident_at),
    }));
  }
}

function numeric(value: string | number | null): number { return value === null ? 0 : Number(value); }
function requireInterval(value: number): void { if (!Number.isSafeInteger(value) || value < 60 || value > 86_400) throw new Error("invalid dashboard interval"); }
