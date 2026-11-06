export const DASHBOARD_RANGES = ["1h", "4h", "24h", "7d", "30d"] as const;
export const DASHBOARD_INTERVALS = ["5m", "15m", "1h", "6h", "1d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type DashboardInterval = (typeof DASHBOARD_INTERVALS)[number];

export interface DashboardWindow {
  readonly from: Date;
  readonly to: Date;
  readonly previousFrom: Date;
}

export interface DashboardRequest {
  readonly orgId: string;
  readonly range: DashboardRange;
}

export interface DashboardTimelineRequest extends DashboardRequest {
  readonly interval?: DashboardInterval;
}

export interface DashboardTopAssetsRequest extends DashboardRequest {
  readonly limit: number;
}

export interface DashboardIncidentMetrics {
  readonly open: number;
  readonly previousOpen: number;
  readonly critical: number;
  readonly previousCritical: number;
  readonly investigating: number;
  readonly resolved: number;
  readonly closed: number;
  readonly severity: Readonly<Record<"critical" | "high" | "medium" | "low" | "informational", number>>;
  readonly averageResponseMinutes: number;
  readonly previousAverageResponseMinutes: number;
  readonly medianResponseMinutes: number;
}

export interface DashboardAlertMetrics {
  readonly total: number;
  readonly previousTotal: number;
  readonly ruleAlerts: number;
  readonly aiAlerts: number;
}

export interface DashboardEventMetrics {
  readonly total: number;
  readonly previousTotal: number;
}

export interface DashboardTimelineRow {
  readonly timestamp: Date;
  readonly severity: "critical" | "high" | "medium" | "low" | "informational";
  readonly count: number;
}

export interface DashboardTopAssetRow {
  readonly entity: string;
  readonly entityType: string;
  readonly incidentCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly latestIncidentAt: Date;
}

export interface DashboardSourceRow {
  readonly source: string;
  readonly eventCount: number;
}

export interface IDashboardPostgresRepository {
  getIncidentMetrics(orgId: string, window: DashboardWindow): Promise<DashboardIncidentMetrics>;
  getAlertMetrics(orgId: string, window: DashboardWindow): Promise<DashboardAlertMetrics>;
  getTimeline(orgId: string, window: DashboardWindow, intervalSeconds: number): Promise<readonly DashboardTimelineRow[]>;
  getTopAssets(orgId: string, window: DashboardWindow, limit: number): Promise<readonly DashboardTopAssetRow[]>;
}

export interface IDashboardEventRepository {
  getMetrics(orgId: string, window: DashboardWindow): Promise<DashboardEventMetrics>;
  getSourceBreakdown(orgId: string, window: DashboardWindow): Promise<readonly DashboardSourceRow[]>;
}

export interface DashboardAiHealth {
  readonly status: "online" | "degraded" | "offline";
  readonly modelVersion: string | null;
}

export interface IDashboardAiHealthProvider {
  getStatus(): Promise<DashboardAiHealth>;
}

export interface DashboardClock { now(): Date; }
export const dashboardSystemClock: DashboardClock = { now: () => new Date() };
