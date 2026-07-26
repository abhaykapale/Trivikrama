import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface QueueMetricsRecord {
  readonly id: string;
  readonly queueName: string;
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly deadLettered: number;
  readonly isPaused: boolean;
  readonly snapshotAt: Date;
}

export interface CreateQueueMetricsSnapshotInput {
  readonly id?: string;
  readonly queueName: string;
  readonly waiting?: number;
  readonly active?: number;
  readonly completed?: number;
  readonly failed?: number;
  readonly deadLettered?: number;
  readonly isPaused?: boolean;
  readonly snapshotAt?: Date;
}

export interface QueueMetricsListFilters extends PaginationOptions {
  readonly queueName?: string;
  readonly snapshotFrom?: Date;
  readonly snapshotTo?: Date;
}

export interface IQueueMetricsRepository {
  withTransaction(transaction: TransactionClient): IQueueMetricsRepository;
  createSnapshot(input: CreateQueueMetricsSnapshotInput): Promise<QueueMetricsRecord>;
  findLatest(queueName: string): Promise<QueueMetricsRecord | null>;
  list(filters?: QueueMetricsListFilters): Promise<PageResult<QueueMetricsRecord>>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}
