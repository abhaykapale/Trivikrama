import "./config/env.js";

import type { Server } from "node:http";

import env from "./config/env.js";
import {
  closeDatabases,
  createPostgresRepositories,
  createPostgresUnitOfWork,
  initializeDatabases,
  type DatabaseClients,
} from "./database/index.js";
import { createAuthApplicationDependencies } from "./modules/auth/composition/index.js";
import { createCollectorMonitoringDependencies } from "./modules/collector-monitoring/index.js";
import type { CollectorMonitoringDependencies } from "./modules/collector-monitoring/index.js";
import HealthService from "./modules/health/health.service.js";
import { createUserManagementDependencies } from "./modules/users/composition/index.js";
import { ShutdownCoordinator } from "./runtime/shutdown-coordinator.js";
import logger from "./shared/logger/index.js";
import startServer from "./server.js";

let isShuttingDown = false;

const registerSignalHandlers = (coordinator: ShutdownCoordinator): void => {
  process.once("SIGINT", () => {
    void gracefulShutdown("SIGINT", coordinator);
  });
  process.once("SIGTERM", () => {
    void gracefulShutdown("SIGTERM", coordinator);
  });
};

const gracefulShutdown = async (
  signal: NodeJS.Signals,
  coordinator: ShutdownCoordinator,
): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  const result = await coordinator.shutdown();

  for (const failure of result.failures) {
    logger.error("Failed to close runtime resource", {
      resource: failure.resourceName,
      error: failure.error,
    });
  }

  if (result.failures.length > 0) {
    process.exitCode = 1;
    logger.error("Shutdown completed with failures.");
    return;
  }

  logger.info("Shutdown complete.", { closed: result.closed });
};

const bootstrap = async (): Promise<void> => {
  let databaseClients: DatabaseClients | null = null;
  let server: Server | null = null;
  let collectorMonitoringDependencies: CollectorMonitoringDependencies | null = null;

  try {
    logger.info("Initializing databases...");

    databaseClients = await initializeDatabases({
      postgres: {
        connectionString: env.database.DATABASE_URL,
        poolMin: env.database.postgres.poolMin,
        poolMax: env.database.postgres.poolMax,
        acquireConnectionTimeoutMs: env.database.postgres.connectionTimeoutMs,
        statementTimeoutMs: env.database.postgres.queryTimeoutMs,
        applicationName: "trivikrama-backend",
      },
      mongodb: {
        uri: env.database.MONGODB_URI,
        minPoolSize: 0,
        maxPoolSize: env.database.mongodb.poolSize,
        serverSelectionTimeoutMs: env.database.mongodb.serverSelectionTimeoutMs,
      },
      redis: {
        url: env.database.REDIS_URL,
        keyPrefix: toRedisClientKeyPrefix(env.database.redis.keyPrefix),
      },
    });

    const healthService = new HealthService(databaseClients);
    const repositories = createPostgresRepositories(databaseClients.postgres);
    const unitOfWork = createPostgresUnitOfWork(databaseClients.postgres);
    const authApplicationDependencies = createAuthApplicationDependencies({
      knex: databaseClients.postgres,
      repositories: {
        users: repositories.users,
        sessions: repositories.sessions,
        audit: repositories.audit,
      },
      appConfig: env,
      unitOfWork,
    });
    const userManagementDependencies = createUserManagementDependencies({
      userRepository: repositories.users,
      userCreationRepository: repositories.users,
      passwordHasher: authApplicationDependencies.passwordService,
      unitOfWork,
    });
    collectorMonitoringDependencies =
      createCollectorMonitoringDependencies({
        collectorStatusRepository: repositories.collectorStatus,
        redisUrl: env.database.REDIS_URL,
        collectorHandoffRoot: env.collector.directory,
        aiEngineUrl: env.ai.engineUrl,
        aiTimeoutMs: env.ai.timeoutMs,
      });

    const authenticationDependencies = {
      jwtService: authApplicationDependencies.jwtService,
      sessionRepository: repositories.sessions,
      userRepository: repositories.users,
      config: env,
    };

    logger.info("Databases initialized successfully.");
    logger.info("Starting server...");

    server = startServer({
      healthService,
      appConfig: env,
      auth: {
        authService: authApplicationDependencies.authService,
        jwtService: authApplicationDependencies.jwtService,
        sessionRepository: repositories.sessions,
        userRepository: repositories.users,
        redisClient: databaseClients.redis,
        config: env,
      },
      users: {
        authentication: authenticationDependencies,
        listUsersUseCase: userManagementDependencies.listUsersUseCase,
        getUserByIdUseCase: userManagementDependencies.getUserByIdUseCase,
        deactivateUserByIdUseCase:
          userManagementDependencies.deactivateUserByIdUseCase,
        createUserUseCase: userManagementDependencies.createUserUseCase,
        updateUserUseCase: userManagementDependencies.updateUserUseCase,
        resetUserPasswordUseCase:
          userManagementDependencies.resetUserPasswordUseCase,
      },
      collectorMonitoring: {
        authentication: authenticationDependencies,
        getCollectorStatusUseCase:
          collectorMonitoringDependencies.getCollectorStatusUseCase,
      },
    });

    registerSignalHandlers(
      new ShutdownCoordinator([
        {
          name: "http-server",
          close: () => closeHttpServer(server!),
        },
        {
          name: "collector-queue-monitor",
          close: () => collectorMonitoringDependencies!.close(),
        },
        {
          name: "databases",
          close: async () => {
            const result = await closeDatabases(databaseClients!);

            if (result.failed.length > 0) {
              throw new Error(
                `Database shutdown failed for: ${result.failed.join(", ")}`,
              );
            }
          },
        },
      ]),
    );

    logger.info("Server started successfully.");
  } catch (error: unknown) {
    logger.error("Failed to bootstrap application", { error });

    if (server !== null) {
      await closeHttpServer(server).catch((closeError: unknown) => {
        logger.error("Failed to close HTTP server after bootstrap failure", {
          error: closeError,
        });
      });
    }

    if (collectorMonitoringDependencies !== null) {
      await collectorMonitoringDependencies.close().catch(
        (closeError: unknown) => {
          logger.error(
            "Failed to close Collector queue monitor after bootstrap failure",
            { error: closeError },
          );
        },
      );
    }

    if (databaseClients !== null) {
      const result = await closeDatabases(databaseClients);

      if (result.failed.length > 0) {
        logger.error("Failed to close databases after bootstrap failure", {
          failed: result.failed,
        });
      }
    }

    process.exitCode = 1;
  }
};

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function toRedisClientKeyPrefix(value: string): string {
  return `${value.replace(/:+$/u, "")}:`;
}

void bootstrap();
