import cors from "cors";
import type { Express } from "express";
import express from "express";
import helmet from "helmet";
import type { AppConfig } from "../../config/index.js";
import { csrfProtection } from "./csrf.middleware.js";

export function applySecurityMiddleware(app: Express, config: AppConfig): void {
  app.use(helmet());
  app.use(
    cors({
      origin: config.frontend.url,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(
    csrfProtection({
      config,
      exemptPaths: [`${config.server.apiPrefix}/auth/login`],
    }),
  );
}
