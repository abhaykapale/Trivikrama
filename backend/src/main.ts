import "./config/env.js";

import type { Server } from "node:http";
import logger from "./shared/logger";
import startServer from "./server";
import env from "./config/env.js";
import { initializeDatabases } from "./database/index.js";
import HealthService from "./modules/health/health.service.js";

let server: Server | null = null;
let isShuttingDown = false;

const gracefulShutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (!server) {
    logger.info("No server instance found. Exiting...");
    process.exit(0);
    return;
  }

  server.close((error?: Error) => {
    if (error) {
      logger.error("Failed to close HTTP server cleanly", { error });
      process.exit(1);
      return;
    }

    logger.info("HTTP server closed. Shutdown complete.");
    process.exit(0);
  });
};

const registerSignalHandlers = (): void => {
  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
};

const bootstrap = async (): Promise<void> => {
  try {
    logger.info("Initializing databases...");

    const databaseClients = await initializeDatabases({
      postgres: {
        connectionString: env.database.DATABASE_URL,
        poolMin: env.database.postgres.poolMin,
        poolMax: env.database.postgres.poolMax,
      },
      mongodb: {
        uri: env.database.MONGODB_URI,
        minPoolSize: 0,
        maxPoolSize: env.database.mongodb.poolSize,
      },
      redis: {
        url: env.database.REDIS_URL,
      },
    });

    const healthService = new HealthService(databaseClients);

    logger.info("Databases initialized successfully.");

    logger.info("Starting server...");


    server = startServer({
      healthService,
    });

    registerSignalHandlers();

    logger.info("Server started successfully.");
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Failed to bootstrap application: ${error.message}`);
      logger.error(error.stack ?? "");
    } else {
      logger.error("Failed to bootstrap application");
      logger.error(String(error));
    }

    process.exit(1);
  }
};

void bootstrap();
