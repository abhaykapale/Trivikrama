import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export type CollectorStatusValue = "online" | "degraded" | "offline";

export interface CollectorStatusRecord {
  readonly id: string;
  readonly collectorId: string;
  readonly status: CollectorStatusValue;
  readonly lastHeartbeatAt: Date | null;
  readonly heartbeatData: Record<string, unknown>;
  readonly filesProcessed: number;
  readonly eventsCollected: number;
  readonly eventsDropped: number;
  readonly errorsCount: number;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly firstSeenAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

export interface UpsertCollectorStatusInput {
  readonly id?: string;
  readonly collectorId: string;
  readonly status: CollectorStatusValue;
  readonly lastHeartbeatAt?: Date | null;
  readonly heartbeatData?: Record<string, unknown>;
  readonly filesProcessed?: number;
  readonly eventsCollected?: number;
  readonly eventsDropped?: number;
  readonly errorsCount?: number;
  readonly cpuPercent?: number | null;
  readonly memoryMb?: number | null;
  readonly orgId?: string;
}

export interface CollectorStatusListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly status?: CollectorStatusValue;
  readonly staleBefore?: Date;
  readonly search?: string;
}

export interface ICollectorStatusRepository {
  withTransaction(transaction: TransactionClient): ICollectorStatusRepository;
  findById(id: string): Promise<CollectorStatusRecord | null>;
  findByCollectorId(collectorId: string): Promise<CollectorStatusRecord | null>;
  list(filters?: CollectorStatusListFilters): Promise<PageResult<CollectorStatusRecord>>;
  upsertHeartbeat(input: UpsertCollectorStatusInput): Promise<CollectorStatusRecord>;
  markOffline(collectorId: string): Promise<CollectorStatusRecord | null>;
}
