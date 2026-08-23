import express, { type Express } from "express";
import config, { type AppConfig } from "./config/index.js";
import {
  createAuthRouter,
  type CreateAuthRouterDependencies,
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
  readonly appConfig?: AppConfig;
  readonly users?: CreateUsersRouterDependencies;
}

export function createApp({
  healthService,
  auth,
  appConfig = config,
  users,
}: AppDependencies): Express {
  const app = express();

  applySecurityMiddleware(app, appConfig);

  app.use("/", createHealthRouter(healthService));

  if (auth !== undefined) {
    app.use(`${appConfig.server.apiPrefix}/auth`, createAuthRouter(auth));
  }

  if(users !== undefined){
    app.use(`${appConfig.server.apiPrefix}/users`, createUsersRouter(users));
  }


  app.use(errorMiddleware);

  return app;
}
