import {
  checkDatabaseHealth,
  type DatabaseHealthClients,
} from "../../database/health.js";
import type { HealthResponse } from "./health.types.js";

class HealthService {
  public constructor(private readonly databaseClients: DatabaseHealthClients) {}

  public async getHealth(): Promise<HealthResponse> {
    const databaseHealth = await checkDatabaseHealth(this.databaseClients);

    return {
      status: databaseHealth.status === "healthy" ? "UP" : "DEGRADED",

      uptime: process.uptime(),
      timestamp: new Date().toISOString(),

      dependencies: {
        postgres: {
          status:
            databaseHealth.checks.postgres.status === "connected"
              ? "UP"
              : "DOWN",
          latencyMs: databaseHealth.checks.postgres.latencyMs,
        },

        mongodb: {
          status:
            databaseHealth.checks.mongodb.status === "connected"
              ? "UP"
              : "DOWN",
          latencyMs: databaseHealth.checks.mongodb.latencyMs,
        },

        redis: {
          status:
            databaseHealth.checks.redis.status === "connected" ? "UP" : "DOWN",
          latencyMs: databaseHealth.checks.redis.latencyMs,
        },
      },
    };
  }
}

export default HealthService;
