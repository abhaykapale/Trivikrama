export type HealthStatus = "UP" | "DEGRADED" | "DOWN";

export type DependencyHealthStatus = "UP" | "DOWN" | "NOT_CONFIGURED";

export interface DependencyHealth {
  readonly status: DependencyHealthStatus;
  readonly latencyMs: number | null;
}

export interface HealthResponse {
  readonly status: HealthStatus;
  readonly uptime: number;
  readonly timestamp: string;

  readonly dependencies: {
    readonly postgres: DependencyHealth;
    readonly mongodb: DependencyHealth;
    readonly redis: DependencyHealth;
  };
}
