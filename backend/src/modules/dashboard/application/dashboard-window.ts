import type { DashboardClock, DashboardInterval, DashboardRange, DashboardWindow } from "../domain/dashboard.contracts.js";

const RANGE_SECONDS: Record<DashboardRange, number> = {
  "1h": 3_600,
  "4h": 14_400,
  "24h": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
};
const INTERVAL_SECONDS: Record<DashboardInterval, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "6h": 21_600,
  "1d": 86_400,
};
const DEFAULT_INTERVAL: Record<DashboardRange, DashboardInterval> = {
  "1h": "5m",
  "4h": "15m",
  "24h": "1h",
  "7d": "6h",
  "30d": "1d",
};
export const MAX_DASHBOARD_BUCKETS = 500;

export function dashboardWindow(range: DashboardRange, clock: DashboardClock): DashboardWindow {
  const to = clock.now();
  const durationMs = RANGE_SECONDS[range] * 1_000;
  const from = new Date(to.getTime() - durationMs);
  return { from, to, previousFrom: new Date(from.getTime() - durationMs) };
}

export function rangeSeconds(range: DashboardRange): number { return RANGE_SECONDS[range]; }

export function resolveDashboardInterval(range: DashboardRange, requested?: DashboardInterval) {
  const interval = requested ?? DEFAULT_INTERVAL[range];
  const seconds = INTERVAL_SECONDS[interval];
  const buckets = Math.ceil(RANGE_SECONDS[range] / seconds);
  if (buckets > MAX_DASHBOARD_BUCKETS) {
    throw new DashboardIntervalTooFineError(range, interval, buckets);
  }
  return { interval, seconds, buckets };
}

export class DashboardIntervalTooFineError extends Error {
  public readonly code = "DASHBOARD_INTERVAL_TOO_FINE" as const;
  public constructor(
    public readonly range: DashboardRange,
    public readonly interval: DashboardInterval,
    public readonly buckets: number,
  ) {
    super(`Interval ${interval} creates ${buckets} buckets for range ${range}; maximum is ${MAX_DASHBOARD_BUCKETS}.`);
    this.name = "DashboardIntervalTooFineError";
  }
}
