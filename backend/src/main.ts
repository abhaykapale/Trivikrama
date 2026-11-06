import "./config/env.js";

import type { Server } from "node:http";

import env from "./config/env.js";
import {
  closeDatabases,
  createMongoRepositories,
  createPostgresRepositories,
  createPostgresUnitOfWork,
  initializeDatabases,
  type DatabaseClients,
} from "./database/index.js";
import { createAuthApplicationDependencies } from "./modules/auth/composition/index.js";
import { createAuditQueryDependencies } from "./modules/audit/index.js";
import { createAssetDependencies } from "./modules/assets/index.js";
import { createCollectorMonitoringDependencies } from "./modules/collector-monitoring/index.js";
import { createConfigurationDependencies } from "./modules/configuration/index.js";
import { createDashboardDependencies } from "./modules/dashboard/index.js";
import { createEventQueryDependencies } from "./modules/events/index.js";
import { createRuleQueryDependencies } from "./modules/detection/composition/rule-query.dependencies.js";
import { createRuleCommandDependencies } from "./modules/detection/composition/rule-command.dependencies.js";
import { createRuleOperationalDependencies } from "./modules/detection/composition/rule-operational.dependencies.js";
import type { CollectorMonitoringDependencies } from "./modules/collector-monitoring/index.js";
import HealthService from "./modules/health/health.service.js";
import {
  createIncidentCommandDependencies,
  createIncidentQueryDependencies,
} from "./modules/incidents/index.js";
import { createUserManagementDependencies } from "./modules/users/composition/index.js";
import { createRealtimeDependencies, type RealtimeDependencies } from "./modules/realtime/index.js";
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
  let realtimeDependencies: RealtimeDependencies | null = null;

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
    const mongoRepositories = createMongoRepositories(databaseClients.mongodb);
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
    const assetDependencies = createAssetDependencies(repositories.assets, unitOfWork);
    const auditQueryDependencies = createAuditQueryDependencies(databaseClients.postgres);
    const configurationDependencies = createConfigurationDependencies(repositories.configuration, unitOfWork);
    const incidentQueryDependencies = createIncidentQueryDependencies(
      databaseClients.postgres,
      mongoRepositories.normalizedEvents,
    );
    const incidentCommandDependencies =
      createIncidentCommandDependencies(unitOfWork);
    const eventQueryDependencies = createEventQueryDependencies(
      databaseClients.mongodb,
    );
    const ruleQueryDependencies = createRuleQueryDependencies(
      databaseClients.postgres,
    );
    const ruleCommandDependencies = createRuleCommandDependencies(
      unitOfWork,
      databaseClients.redis,
    );
    const ruleOperationalDependencies = createRuleOperationalDependencies(
      databaseClients.postgres,
      databaseClients.mongodb,
    );
    collectorMonitoringDependencies =
      createCollectorMonitoringDependencies({
        collectorStatusRepository: repositories.collectorStatus,
        redisUrl: env.database.REDIS_URL,
        collectorHandoffRoot: env.collector.directory,
        aiEngineUrl: env.ai.engineUrl,
        aiTimeoutMs: env.ai.timeoutMs,
      });
    const dashboardDependencies = createDashboardDependencies(
      databaseClients.postgres,
      databaseClients.mongodb,
      collectorMonitoringDependencies.aiEngineHealthMonitor,
    );

    const authenticationDependencies = {
      jwtService: authApplicationDependencies.jwtService,
      sessionRepository: repositories.sessions,
      userRepository: repositories.users,
      config: env,
    };
    realtimeDependencies = createRealtimeDependencies(databaseClients.redis, authenticationDependencies);
    await realtimeDependencies.start();

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
      assets: {
        authentication: authenticationDependencies,
        ...assetDependencies,
      },
      audit: {
        authentication: authenticationDependencies,
        ...auditQueryDependencies,
      },
      configuration: {
        authentication: authenticationDependencies,
        ...configurationDependencies,
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
      incidents: {
        authentication: authenticationDependencies,
        listIncidentsUseCase: incidentQueryDependencies.listIncidentsUseCase,
        getIncidentDetailUseCase:
          incidentQueryDependencies.getIncidentDetailUseCase,
        getIncidentContextUseCase:
          incidentQueryDependencies.getIncidentContextUseCase,
        transitionIncidentStatusUseCase:
          incidentCommandDependencies.transitionIncidentStatusUseCase,
        assignIncidentUseCase:
          incidentCommandDependencies.assignIncidentUseCase,
        addIncidentNoteUseCase:
          incidentCommandDependencies.addIncidentNoteUseCase,
        resolveIncidentUseCase:
          incidentCommandDependencies.resolveIncidentUseCase,
        getIncidentTimelineUseCase:
          incidentQueryDependencies.getIncidentTimelineUseCase,
        listIncidentAlertsUseCase:
          incidentQueryDependencies.listIncidentAlertsUseCase,
        listIncidentEventsUseCase:
          incidentQueryDependencies.listIncidentEventsUseCase,
      },
      events: {
        authentication: authenticationDependencies,
        searchEventsUseCase: eventQueryDependencies.searchEventsUseCase,
        getEventDetailUseCase: eventQueryDependencies.getEventDetailUseCase,
        exportEventsUseCase: eventQueryDependencies.exportEventsUseCase,
      },
      rules: {
        authentication: authenticationDependencies,
        listRulesUseCase: ruleQueryDependencies.listRulesUseCase,
        getRuleDetailUseCase: ruleQueryDependencies.getRuleDetailUseCase,
        createRuleUseCase: ruleCommandDependencies.createRuleUseCase,
        updateRuleUseCase: ruleCommandDependencies.updateRuleUseCase,
        enableRuleUseCase: ruleCommandDependencies.enableRuleUseCase,
        disableRuleUseCase: ruleCommandDependencies.disableRuleUseCase,
        archiveRuleUseCase: ruleCommandDependencies.archiveRuleUseCase,
        importRulesUseCase: ruleCommandDependencies.importRulesUseCase,
        dryRunRuleUseCase: ruleOperationalDependencies.dryRunRuleUseCase,
        exportRulesUseCase: ruleOperationalDependencies.exportRulesUseCase,
      },
      collectorMonitoring: {
        authentication: authenticationDependencies,
        getCollectorStatusUseCase:
          collectorMonitoringDependencies.getCollectorStatusUseCase,
        listQuarantinedFilesUseCase:
          collectorMonitoringDependencies.listQuarantinedFilesUseCase,
        retryQuarantinedFileUseCase:
          collectorMonitoringDependencies.retryQuarantinedFileUseCase,
      },
      dashboard: {
        authentication: authenticationDependencies,
        ...dashboardDependencies,
      },
      realtime: realtimeDependencies,
    });

    registerSignalHandlers(
      new ShutdownCoordinator([
        {
          name: "realtime-gateway",
          close: () => realtimeDependencies!.close(),
        },
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

    if (realtimeDependencies !== null) {
      await realtimeDependencies.close().catch((closeError: unknown) => {
        logger.error("Failed to close real-time gateway after bootstrap failure", { error: closeError });
      });
    }

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
