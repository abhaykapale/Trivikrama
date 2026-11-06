import type { Server } from "node:http";
import { createServer } from "node:http";

import { createApp } from "./app.js";
import config, { type AppConfig } from "./config/index.js";
import logger from "./shared/logger";

import type { CreateAuthRouterDependencies } from "./index.js";
import type { CreateAuditQueryRouterDependencies } from "./index.js";
import type { CreateAssetRouterDependencies } from "./index.js";
import type { CreateCollectorMonitoringRouterDependencies } from "./index.js";
import type { CreateConfigurationRouterDependencies } from "./index.js";
import type { CreateDashboardRouterDependencies } from "./index.js";
import type { CreateIncidentQueryRouterDependencies } from "./index.js";
import type { CreateEventQueryRouterDependencies } from "./index.js";
import type { CreateRuleQueryRouterDependencies } from "./index.js";
import type HealthService from "./modules/health/health.service.js";
import type { CreateUsersRouterDependencies } from "./index.js";
import type { RealtimeDependencies } from "./modules/realtime/index.js";

export interface StartServerDependencies {
  readonly healthService: HealthService;
  readonly auth?: CreateAuthRouterDependencies;
  readonly audit?: CreateAuditQueryRouterDependencies;
  readonly assets?: CreateAssetRouterDependencies;
  readonly collectorMonitoring?: CreateCollectorMonitoringRouterDependencies;
  readonly configuration?: CreateConfigurationRouterDependencies;
  readonly dashboard?: CreateDashboardRouterDependencies;
  readonly incidents?: CreateIncidentQueryRouterDependencies;
  readonly events?: CreateEventQueryRouterDependencies;
  readonly rules?: CreateRuleQueryRouterDependencies;
  readonly users?: CreateUsersRouterDependencies;
  readonly realtime?: Pick<RealtimeDependencies, "attach">;
  readonly appConfig?: AppConfig;
}

const startServer = ({
  healthService,
  auth,
  audit,
  assets,
  collectorMonitoring,
  configuration,
  dashboard,
  incidents,
  events,
  rules,
  users,
  realtime,
  appConfig = config,
}: StartServerDependencies): Server => {
  const app = createApp({
    healthService,
    auth,
    audit,
    assets,
    collectorMonitoring,
    configuration,
    dashboard,
    incidents,
    events,
    rules,
    users,
    appConfig,
  });

  const port = appConfig.server.port;

  const server = createServer(app);
  realtime?.attach(server);
  server.listen(port, () => {
    logger.info(` Server running on port ${port}`);
  });

  return server;
};

export default startServer;
