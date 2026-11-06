import { dashboardWindow, rangeSeconds } from "./dashboard-window.js";
import {
  dashboardSystemClock,
  type DashboardClock,
  type DashboardRequest,
  type IDashboardAiHealthProvider,
  type IDashboardEventRepository,
  type IDashboardPostgresRepository,
} from "../domain/dashboard.contracts.js";

export interface DashboardSummaryResult {
  readonly timeRange: string;
  readonly incidents: { readonly open: number; readonly openTrend: number; readonly critical: number; readonly criticalTrend: number; readonly investigating: number; readonly resolvedToday: number; readonly closedToday: number };
  readonly alerts: { readonly totalToday: number; readonly alertsTrend: number; readonly ruleAlerts: number; readonly aiAlerts: number };
  readonly events: { readonly eventsPerSecond: number; readonly epsTrend: number; readonly totalToday: number };
  readonly responseTime: { readonly avgMinutes: number; readonly avgTrend: number; readonly medianMinutes: number };
  readonly severityDistribution: Readonly<Record<"critical" | "high" | "medium" | "low" | "informational", number>>;
  readonly aiEngine: { readonly status: "online" | "degraded" | "offline"; readonly modelVersion: string | null; readonly anomaliesDetected: number };
}

export class GetDashboardSummaryUseCase {
  public constructor(
    private readonly postgres: IDashboardPostgresRepository,
    private readonly events: IDashboardEventRepository,
    private readonly aiHealth: IDashboardAiHealthProvider,
    private readonly clock: DashboardClock = dashboardSystemClock,
  ) {}

  public async execute(input: DashboardRequest): Promise<DashboardSummaryResult> {
    const window = dashboardWindow(input.range, this.clock);
    const [incidents, alerts, events, aiHealth] = await Promise.all([
      this.postgres.getIncidentMetrics(input.orgId, window),
      this.postgres.getAlertMetrics(input.orgId, window),
      this.events.getMetrics(input.orgId, window),
      this.aiHealth.getStatus(),
    ]);
    const seconds = rangeSeconds(input.range);
    const eps = events.total / seconds;
    const previousEps = events.previousTotal / seconds;
    return {
      timeRange: input.range,
      incidents: {
        open: incidents.open,
        openTrend: percentTrend(incidents.open, incidents.previousOpen),
        critical: incidents.critical,
        criticalTrend: incidents.critical - incidents.previousCritical,
        investigating: incidents.investigating,
        resolvedToday: incidents.resolved,
        closedToday: incidents.closed,
      },
      alerts: { totalToday: alerts.total, alertsTrend: percentTrend(alerts.total, alerts.previousTotal), ruleAlerts: alerts.ruleAlerts, aiAlerts: alerts.aiAlerts },
      events: { eventsPerSecond: round(eps, 2), epsTrend: percentTrend(eps, previousEps), totalToday: events.total },
      responseTime: {
        avgMinutes: round(incidents.averageResponseMinutes, 1),
        avgTrend: percentTrend(incidents.averageResponseMinutes, incidents.previousAverageResponseMinutes),
        medianMinutes: round(incidents.medianResponseMinutes, 1),
      },
      severityDistribution: incidents.severity,
      aiEngine: { status: aiHealth.status, modelVersion: aiHealth.modelVersion, anomaliesDetected: alerts.aiAlerts },
    };
  }
}

function percentTrend(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round(((current - previous) / previous) * 100, 1);
}
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
