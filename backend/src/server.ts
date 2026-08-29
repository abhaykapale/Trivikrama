import type { Server } from "node:http";

import { createApp } from "./app.js";
import config, { type AppConfig } from "./config/index.js";
import logger from "./shared/logger";

import type { CreateAuthRouterDependencies } from "./index.js";
import type HealthService from "./modules/health/health.service.js";
import type { CreateUsersRouterDependencies } from "./index.js";

export interface StartServerDependencies {
  readonly healthService: HealthService;
  readonly auth?: CreateAuthRouterDependencies;
  readonly users?: CreateUsersRouterDependencies;
  readonly appConfig?: AppConfig;
}

const startServer = ({
  healthService,
  auth,
  users,
  appConfig = config,
}: StartServerDependencies): Server => {
  const app = createApp({
    healthService,
    auth,
    users,
    appConfig,
  });

  const port = appConfig.server.port;

  const server = app.listen(port, () => {
    logger.info(` Server running on port ${port}`);
  });

  return server;
};

export default startServer;
