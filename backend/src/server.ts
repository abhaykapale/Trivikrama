import type { Server } from "node:http";

import { createApp } from "./app.js";
import config from "./config";
import logger from "./shared/logger";

import type { CreateAuthRouterDependencies } from "./index.js";
import type HealthService from "./modules/health/health.service.js";

interface StartServerDependencies {
  readonly healthService: HealthService;
  readonly auth?: CreateAuthRouterDependencies;
}

const startServer = ({
  healthService,
  auth,
}: StartServerDependencies): Server => {
  const app = createApp({
    healthService,
    auth,
  });

  const port = config.server.port;

  const server = app.listen(port, () => {
    logger.info(` Server running on port ${port}`);
  });

  return server;
};

export default startServer;
