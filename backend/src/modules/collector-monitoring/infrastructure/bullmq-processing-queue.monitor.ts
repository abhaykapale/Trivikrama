import { Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  DEFAULT_QUEUE_NAME,
  DEFAULT_QUEUE_PREFIX,
} from "../../ingestion/infrastructure/bullmq-processing.queue.js";
import type {
  IProcessingQueueMonitor,
  ProcessingQueueStatusSnapshot,
} from "../domain/collector-monitoring.contracts.js";

export interface BullMqProcessingQueueMonitorConfiguration {
  readonly redisUrl: string;
  readonly queueName?: string;
  readonly prefix?: string;
}

/** Read-only live view of the BullMQ queue used by the ingestion pipeline. */
export class BullMqProcessingQueueMonitor implements IProcessingQueueMonitor {
    private readonly connection: Redis;
    private readonly queue: Queue;

    public constructor(configuration: BullMqProcessingQueueMonitorConfiguration) {
        validateConfiguration(configuration);

        this.connection = new Redis(configuration.redisUrl, {
            lazyConnect: true,
            enableReadyCheck: true,
            maxRetriesPerRequest: 1,
        });
        this.connection.on("error", () => undefined);

        this.queue = new Queue(configuration.queueName ?? DEFAULT_QUEUE_NAME, {
            connection: this.connection,
            prefix: configuration.prefix ?? DEFAULT_QUEUE_PREFIX,
        });
    }

    public async getStatus(): Promise<ProcessingQueueStatusSnapshot> {
        const [counts, waiting, isPaused] = await Promise.all([
            this.queue.getJobCounts("active", "completed", "failed", "delayed"),
            this.queue.getWaitingCount(),
            this.queue.isPaused(),
        ]);

        return {
            name: this.queue.name,
            waiting,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            isPaused,
        };
    }

    public async close(): Promise<void> {
        await this.queue.close();
        this.connection.disconnect();
    }
}

function validateConfiguration(
  configuration: BullMqProcessingQueueMonitorConfiguration,
): void {
  if (configuration.redisUrl.trim().length === 0) {
    throw new Error("BullMQ Redis URL is required.");
  }

  if (
    configuration.queueName !== undefined &&
    configuration.queueName.trim().length === 0
  ) {
    throw new Error("BullMQ queue name cannot be empty.");
  }

  if (
    configuration.prefix !== undefined &&
    configuration.prefix.trim().length === 0
  ) {
    throw new Error("BullMQ queue prefix cannot be empty.");
  }
}

