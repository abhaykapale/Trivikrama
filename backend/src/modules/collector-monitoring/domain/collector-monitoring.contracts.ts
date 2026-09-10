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

