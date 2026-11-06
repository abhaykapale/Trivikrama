import { dashboardWindow } from "./dashboard-window.js";
import { dashboardSystemClock, type DashboardClock, type DashboardTopAssetsRequest, type IDashboardPostgresRepository } from "../domain/dashboard.contracts.js";

export class GetDashboardTopAssetsUseCase {
  public constructor(private readonly repository: IDashboardPostgresRepository, private readonly clock: DashboardClock = dashboardSystemClock) {}
  public async execute(input: DashboardTopAssetsRequest) {
    const rows = await this.repository.getTopAssets(input.orgId, dashboardWindow(input.range, this.clock), input.limit);
    return { assets: rows };
  }
}
