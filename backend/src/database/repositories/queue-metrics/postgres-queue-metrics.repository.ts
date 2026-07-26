import {
  ensureNonBlank,
  pageByLimitOffset,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CreateQueueMetricsSnapshotInput,
  IQueueMetricsRepository,
  QueueMetricsListFilters,
  QueueMetricsRecord,
} from "./queue-metrics.repository.js";

interface QueueMetricsRow {
  readonly id: string;
  readonly queue_name: string;
  readonly waiting: number | string;
  readonly active: number | string;
  readonly completed: number | string;
  readonly failed: number | string;
  readonly dead_lettered: number | string;
  readonly is_paused: boolean;
  readonly snapshot_at: Date | string;
}

const QUEUE_METRICS_TABLE = "monitor.queue_metrics";

export class PostgresQueueMetricsRepository implements IQueueMetricsRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IQueueMetricsRepository {
    return new PostgresQueueMetricsRepository(transaction);
  }

  public async createSnapshot(input: CreateQueueMetricsSnapshotInput): Promise<QueueMetricsRecord> {
    const waiting = input.waiting ?? 0;
    const active = input.active ?? 0;
    const completed = input.completed ?? 0;
    const failed = input.failed ?? 0;
    const deadLettered = input.deadLettered ?? 0;

    validateNonNegative(waiting, "waiting");
    validateNonNegative(active, "active");
    validateNonNegative(completed, "completed");
    validateNonNegative(failed, "failed");
    validateNonNegative(deadLettered, "deadLettered");

    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      queue_name: ensureNonBlank(input.queueName, "queueName"),
      waiting,
      active,
      completed,
      failed,
      dead_lettered: deadLettered,
      is_paused: input.isPaused ?? false,
      snapshot_at: input.snapshotAt ?? new Date(),
    };

    const [row] = await this.db<QueueMetricsRow>(QUEUE_METRICS_TABLE).insert(insertable).returning("*");
    return mapQueueMetricsRow(row);
  }

  public async findLatest(queueName: string): Promise<QueueMetricsRecord | null> {
    const row = await this.baseQuery()
      .where("queue_name", ensureNonBlank(queueName, "queueName"))
      .orderBy("snapshot_at", "desc")
      .orderBy("id", "desc")
      .first<QueueMetricsRow>();

    return row ? mapQueueMetricsRow(row) : null;
  }

  public async list(filters: QueueMetricsListFilters = {}): Promise<PageResult<QueueMetricsRecord>> {
    const query = this.baseQuery().orderBy("snapshot_at", "desc").orderBy("id", "desc");

    if (filters.queueName !== undefined) {
      query.where("queue_name", ensureNonBlank(filters.queueName, "queueName"));
    }

    if (filters.snapshotFrom !== undefined) {
      query.where("snapshot_at", ">=", filters.snapshotFrom);
    }

    if (filters.snapshotTo !== undefined) {
      query.where("snapshot_at", "<=", filters.snapshotTo);
    }

    return pageByLimitOffset<QueueMetricsRow, QueueMetricsRecord>(query, filters, mapQueueMetricsRow);
  }

  public async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.db<QueueMetricsRow>(QUEUE_METRICS_TABLE).where("snapshot_at", "<", cutoff).delete();
  }

  private baseQuery() {
    return this.db<QueueMetricsRow>(QUEUE_METRICS_TABLE).select("*");
  }
}

function validateNonNegative(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be non-negative.`);
  }
}

function mapQueueMetricsRow(row: QueueMetricsRow): QueueMetricsRecord {
  return {
    id: row.id,
    queueName: row.queue_name,
    waiting: Number(row.waiting),
    active: Number(row.active),
    completed: Number(row.completed),
    failed: Number(row.failed),
    deadLettered: Number(row.dead_lettered),
    isPaused: row.is_paused,
    snapshotAt: toRequiredDate(row.snapshot_at),
  };
}
