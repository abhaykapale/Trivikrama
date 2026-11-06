import express, { type Express } from "express";
import config, { type AppConfig } from "./config/index.js";
import {
  createAuthRouter,
  createAuditQueryRouter,
  type CreateAuditQueryRouterDependencies,
  createAssetRouter,
  type CreateAssetRouterDependencies,
  type CreateAuthRouterDependencies,
  createCollectorMonitoringRouter,
  type CreateCollectorMonitoringRouterDependencies,
  createConfigurationRouter,
  type CreateConfigurationRouterDependencies,
  createDashboardRouter,
  type CreateDashboardRouterDependencies,
  createEventQueryRouter,
  type CreateEventQueryRouterDependencies,
  createIncidentQueryRouter,
  type CreateIncidentQueryRouterDependencies,
  createRuleQueryRouter,
  type CreateRuleQueryRouterDependencies,
  createUsersRouter,
  type CreateUsersRouterDependencies,
} from "./index.js";
import errorMiddleware from "./middleware/error.middleware.js";
import { applySecurityMiddleware } from "./middleware/security/index.js";
import createHealthRouter from "./modules/health/health.routes.js";
import type HealthService from "./modules/health/health.service.js";

export interface AppDependencies {
  readonly healthService: HealthService;
  readonly auth?: CreateAuthRouterDependencies;
  readonly audit?: CreateAuditQueryRouterDependencies;
  readonly assets?: CreateAssetRouterDependencies;
  readonly appConfig?: AppConfig;
  readonly collectorMonitoring?: CreateCollectorMonitoringRouterDependencies;
  readonly configuration?: CreateConfigurationRouterDependencies;
  readonly dashboard?: CreateDashboardRouterDependencies;
  readonly events?: CreateEventQueryRouterDependencies;
  readonly incidents?: CreateIncidentQueryRouterDependencies;
  readonly rules?: CreateRuleQueryRouterDependencies;
  readonly users?: CreateUsersRouterDependencies;
}

export function createApp({
  healthService,
  auth,
  audit,
  assets,
  appConfig = config,
  collectorMonitoring,
  configuration,
  dashboard,
  events,
  incidents,
  rules,
  users,
}: AppDependencies): Express {
  const app = express();

  applySecurityMiddleware(app, appConfig);

  app.use("/", createHealthRouter(healthService));

  if (auth !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/auth`, createAuthRouter(auth));
  }

  if (audit !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/audit`, createAuditQueryRouter(audit));
  }

  if (assets !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/assets`, createAssetRouter(assets));
  }

  if (collectorMonitoring !== undefined) {
    app.use(
      `${appConfig.server.apiPrefix}/collector`,
      createCollectorMonitoringRouter(collectorMonitoring),
    );
  }

  if (configuration !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/config`, createConfigurationRouter(configuration));
  }

  if (dashboard !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/dashboard`, createDashboardRouter(dashboard));
  }

  if (incidents !== undefined) {
    app.use(
      `${appConfig.server.apiPrefix}/incidents`,
      createIncidentQueryRouter(incidents),
    );
  }

  if (events !== undefined) {
    app.use(
      `${appConfig.server.apiPrefix}/events`,
      createEventQueryRouter(events),
    );
  }

  if (rules !== undefined) {
    app.use(
      `${appConfig.server.apiPrefix}/rules`,
      createRuleQueryRouter(rules),
    );
  }

  if(users !== undefined){
    app.use(`${appConfig.server.apiPrefix}/users`, createUsersRouter(users));
  }


  app.use(errorMiddleware);

  return app;
}
