import type { MongoDbClient } from "../../../database/mongodb/client.js";
import type { PostgresClient } from "../../../database/postgres/client.js";
import type { IAiEngineHealthMonitor } from "../../collector-monitoring/domain/collector-monitoring.contracts.js";
import { GetDashboardSourceBreakdownUseCase } from "../application/get-dashboard-source-breakdown.use-case.js";
import { GetDashboardSummaryUseCase } from "../application/get-dashboard-summary.use-case.js";
import { GetDashboardTimelineUseCase } from "../application/get-dashboard-timeline.use-case.js";
import { GetDashboardTopAssetsUseCase } from "../application/get-dashboard-top-assets.use-case.js";
import { MongoDashboardEventRepository } from "../infrastructure/mongo-dashboard-event.repository.js";
import { PostgresDashboardRepository } from "../infrastructure/postgres-dashboard.repository.js";

export interface DashboardDependencies {
  readonly getDashboardSummaryUseCase: GetDashboardSummaryUseCase;
  readonly getDashboardTimelineUseCase: GetDashboardTimelineUseCase;
  readonly getDashboardTopAssetsUseCase: GetDashboardTopAssetsUseCase;
  readonly getDashboardSourceBreakdownUseCase: GetDashboardSourceBreakdownUseCase;
}

export function createDashboardDependencies(
  postgres: PostgresClient,
  mongodb: MongoDbClient,
  aiHealth: IAiEngineHealthMonitor,
): DashboardDependencies {
  const relational = new PostgresDashboardRepository(postgres);
  const events = new MongoDashboardEventRepository(mongodb);
  return {
    getDashboardSummaryUseCase: new GetDashboardSummaryUseCase(relational, events, aiHealth),
    getDashboardTimelineUseCase: new GetDashboardTimelineUseCase(relational),
    getDashboardTopAssetsUseCase: new GetDashboardTopAssetsUseCase(relational),
    getDashboardSourceBreakdownUseCase: new GetDashboardSourceBreakdownUseCase(events),
  };
}
