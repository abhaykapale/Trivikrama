export type MonitoredCollectorStatus = "online" | "degraded" | "offline";

export interface MonitoredCollectorRecord {
  readonly collectorId: string;
  readonly status: MonitoredCollectorStatus;
  readonly lastHeartbeatAt: Date | null;
  readonly heartbeatData: Readonly<Record<string, unknown>>;
  readonly filesProcessed: number;
  readonly eventsCollected: number;
  readonly eventsDropped: number;
  readonly errorsCount: number;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly firstSeenAt: Date;
}

export interface ICollectorMonitoringRepository {
  listByOrgId(orgId: string): Promise<readonly MonitoredCollectorRecord[]>;
}

export interface ProcessingQueueStatusSnapshot {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly isPaused: boolean;
}

export interface QuarantineStatusSnapshot {
  readonly count: number;
}

export interface IProcessingQueueMonitor {
  getStatus(): Promise<ProcessingQueueStatusSnapshot>;
}

export interface IQuarantineMonitor {
  getStatus(): Promise<QuarantineStatusSnapshot>;
}

export type AiEngineStatus = "online" | "degraded" | "offline";

export interface AiEngineHealthSnapshot {
  readonly status: AiEngineStatus;
  readonly modelVersion: string | null;
  readonly uptimeSeconds: number | null;
  readonly totalPredictions: number | null;
  readonly avgLatencyMs: number | null;
  readonly p99LatencyMs: number | null;
}

export interface IAiEngineHealthMonitor {
  getStatus(): Promise<AiEngineHealthSnapshot>;
}
