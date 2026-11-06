import { dashboardWindow } from "./dashboard-window.js";
import { dashboardSystemClock, type DashboardClock, type DashboardRequest, type IDashboardEventRepository } from "../domain/dashboard.contracts.js";

export class GetDashboardSourceBreakdownUseCase {
  public constructor(private readonly events: IDashboardEventRepository, private readonly clock: DashboardClock = dashboardSystemClock) {}
  public async execute(input: DashboardRequest) {
    const rows = await this.events.getSourceBreakdown(input.orgId, dashboardWindow(input.range, this.clock));
    const total = rows.reduce((sum, row) => sum + row.eventCount, 0);
    return {
      sources: rows.map((row) => ({ ...row, percentage: total === 0 ? 0 : Math.round((row.eventCount / total) * 1_000) / 10 })),
      total,
    };
  }
}
