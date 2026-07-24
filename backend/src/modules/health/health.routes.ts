import { Router } from "express";
import type HealthService from "./health.service.js";

export default function createHealthRouter(
  healthService: HealthService,
): Router {
  const router = Router();

  router.get("/health", async (_request, response, next) => {
    try {
      const health = await healthService.getHealth();

      const statusCode = health.status === "UP" ? 200 : 503;

      response.status(statusCode).json(health);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
