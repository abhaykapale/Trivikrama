export type DatabaseMaintenanceCommand =
  | "status"
  | "partitions"
  | "retention"
  | "vacuum"
  | "run";

export type DatabaseMaintenanceCheckStatus = "pass" | "warn" | "fail" | "skip";

export type PartitionCadence = "monthly" | "weekly";

export interface DatabaseMaintenanceConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly connectionString: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly futureMonthlyPartitions: number;
  readonly futureWeeklyPartitions: number;
  readonly auditLogsRetentionMonths: number;
  readonly incidentEventsRetentionMonths: number;
  readonly queueMetricsRetentionDays: number;
  readonly allowDestructiveRetention: boolean;
  readonly vacuumAnalyzeTables: readonly string[];
}

export interface MaintenancePartitionTarget {
  readonly schemaName: string;
  readonly tableName: string;
  readonly partitionColumn: string;
  readonly cadence: PartitionCadence;
  readonly futurePartitions: number;
}

export interface PartitionPlanItem {
  readonly parentTable: string;
  readonly partitionName: string;
  readonly from: string;
  readonly to: string;
  readonly exists: boolean;
  readonly created: boolean;
}

export interface RetentionPlanItem {
  readonly parentTable: string;
  readonly partitionName: string;
  readonly from: string;
  readonly to: string;
  readonly cutoff: string;
  readonly eligibleForDrop: boolean;
  readonly dropped: boolean;
}

export interface VacuumAnalyzeResult {
  readonly tableName: string;
  readonly status: DatabaseMaintenanceCheckStatus;
  readonly message: string;
}

export interface DatabaseMaintenanceCheck {
  readonly name: string;
  readonly status: DatabaseMaintenanceCheckStatus;
  readonly message: string;
  readonly latencyMs?: number;
  readonly details?: unknown;
}

export interface DatabaseMaintenanceResult {
  readonly command: DatabaseMaintenanceCommand;
  readonly nodeEnv: string;
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly checks: readonly DatabaseMaintenanceCheck[];
  readonly summary: {
    readonly partitionsPlanned: number;
    readonly partitionsCreated: number;
    readonly retentionEligible: number;
    readonly partitionsDropped: number;
    readonly vacuumedTables: number;
  };
}
