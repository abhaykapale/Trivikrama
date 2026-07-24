import express, { type Express } from "express";
import createHealthRouter from "./modules/health/health.routes.js";
import type HealthService from "./modules/health/health.service.js";
import errorMiddleware from "./middleware/error.middleware.js";

export interface AppDependencies {
  readonly healthService: HealthService;
}

export function createApp({ healthService }: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/", createHealthRouter(healthService));

  app.use(errorMiddleware);

  return app;
}
