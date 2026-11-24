export const DASHBOARD_RANGES = ["1h", "4h", "24h", "7d", "30d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface DashboardSummary {
  readonly timeRange: string;
  readonly incidents: {
    readonly open: number;
    readonly openTrend: number;
    readonly critical: number;
    readonly criticalTrend: number;
    readonly investigating: number;
    readonly resolvedToday: number;
    readonly closedToday: number;
  };
  readonly alerts: {
    readonly totalToday: number;
    readonly alertsTrend: number;
    readonly ruleAlerts: number;
    readonly aiAlerts: number;
  };
  readonly events: {
    readonly eventsPerSecond: number;
    readonly epsTrend: number;
    readonly totalToday: number;
  };
  readonly responseTime: {
    readonly avgMinutes: number;
    readonly avgTrend: number;
    readonly medianMinutes: number;
  };
  readonly severityDistribution: Readonly<Record<Severity, number>>;
  readonly aiEngine: {
    readonly status: "online" | "degraded" | "offline";
    readonly modelVersion: string | null;
    readonly anomaliesDetected: number;
  };
}

export interface DashboardTimelineBucket extends Readonly<Record<Severity, number>> {
  readonly timestamp: string;
  readonly total: number;
}

export interface DashboardTimeline {
  readonly timeRange: string;
  readonly interval: string;
  readonly buckets: readonly DashboardTimelineBucket[];
}

export interface DashboardAsset {
  readonly entity: string;
  readonly entityType: string;
  readonly incidentCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly latestIncidentAt: string;
}

export interface DashboardTopAssets {
  readonly assets: readonly DashboardAsset[];
}

export interface DashboardSource {
  readonly source: string;
  readonly eventCount: number;
  readonly percentage: number;
}

export interface DashboardSourceBreakdown {
  readonly sources: readonly DashboardSource[];
  readonly total: number;
}

export interface RecentIncident {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "investigating" | "resolved" | "closed";
  readonly severity: Severity;
  readonly riskScore: number;
  readonly source: "rule" | "ai" | "both";
  readonly primaryEntity: string | null;
  readonly alertCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecentIncidentPage {
  readonly data: readonly RecentIncident[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
  };
}

export interface DashboardData {
  readonly summary: DashboardSummary | null;
  readonly timeline: DashboardTimeline | null;
  readonly topAssets: DashboardTopAssets | null;
  readonly sources: DashboardSourceBreakdown | null;
  readonly incidents: RecentIncidentPage | null;
}

export type DashboardSection = keyof DashboardData;
