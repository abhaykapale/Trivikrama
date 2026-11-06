import { dashboardWindow, resolveDashboardInterval } from "./dashboard-window.js";
import { dashboardSystemClock, type DashboardClock, type DashboardTimelineRequest, type IDashboardPostgresRepository } from "../domain/dashboard.contracts.js";

export interface DashboardTimelineBucket {
  readonly timestamp: Date;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly informational: number;
  readonly total: number;
}

export class GetDashboardTimelineUseCase {
  public constructor(private readonly repository: IDashboardPostgresRepository, private readonly clock: DashboardClock = dashboardSystemClock) {}
  public async execute(input: DashboardTimelineRequest) {
    const window = dashboardWindow(input.range, this.clock);
    const resolved = resolveDashboardInterval(input.range, input.interval);
    const rows = await this.repository.getTimeline(input.orgId, window, resolved.seconds);
    const keyed = new Map(rows.map((row) => [`${row.timestamp.getTime()}:${row.severity}`, row.count]));
    const startMs = Math.floor(window.from.getTime() / (resolved.seconds * 1_000)) * resolved.seconds * 1_000;
    const buckets: DashboardTimelineBucket[] = [];
    for (let timestamp = startMs; timestamp < window.to.getTime(); timestamp += resolved.seconds * 1_000) {
      const read = (severity: string) => keyed.get(`${timestamp}:${severity}`) ?? 0;
      const bucket = { timestamp: new Date(timestamp), critical: read("critical"), high: read("high"), medium: read("medium"), low: read("low"), informational: read("informational") };
      buckets.push({ ...bucket, total: bucket.critical + bucket.high + bucket.medium + bucket.low + bucket.informational });
    }
    return { timeRange: input.range, interval: resolved.interval, buckets };
  }
}
