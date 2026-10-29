import { Worker } from "bullmq";
import { Redis } from "ioredis";

import type { HandleCollectorProcessingJobService } from "../application/handle-collector-processing-job.service.js";
import type { CollectorProcessingJob } from "../domain/processing-queue.contracts.js";
import {
    DEFAULT_QUEUE_NAME,
    DEFAULT_QUEUE_PREFIX,
    PROCESS_COLLECTOR_BATCH_JOB_NAME,
} from "./bullmq-processing.queue.js";

export interface BullMqCollectorProcessingWorkerConfiguration {
    readonly redisUrl: string;
    readonly queueName?: string;
    readonly prefix?: string;
    readonly concurrency?: number;
    readonly onCompleted?: (job: CollectorProcessingJob) => void;
    readonly onFailed?: (job: CollectorProcessingJob | undefined, error: Error) => void;
}

export interface BullMqCollectorProcessingWorkerDependencies {
    readonly jobHandler: Pick<HandleCollectorProcessingJobService, "execute">;
}

/**
 * BullMQ infrastructure adapter for processing claimed Collector batches.
 *
 * A handler error is intentionally rethrown to BullMQ, which marks the job as
 * failed and applies its configured retry policy.
 */

export class BullMqCollectorProcessingWorker {
    private readonly connection: Redis;
    private readonly worker: Worker<
        CollectorProcessingJob,
        void,
        typeof PROCESS_COLLECTOR_BATCH_JOB_NAME
    >;

    public constructor(
        configuration: BullMqCollectorProcessingWorkerConfiguration,
        dependencies: BullMqCollectorProcessingWorkerDependencies,
    ) {
        validateConfiguration(configuration);

        this.connection = new Redis(configuration.redisUrl, {
            lazyConnect: true,
            enableReadyCheck: true,
            maxRetriesPerRequest: null,
        });

        this.connection.on("error", () => undefined);

        this.worker = new Worker<
            CollectorProcessingJob,
            void,
            typeof PROCESS_COLLECTOR_BATCH_JOB_NAME
        >(
            configuration.queueName ?? DEFAULT_QUEUE_NAME,
            async (job) => {
                if (job.name !== PROCESS_COLLECTOR_BATCH_JOB_NAME) {
                    throw new Error(`Unsupported Collector processing job: ${job.name}`);
                }

                await dependencies.jobHandler.execute(job.data);
            },
            {
                connection: this.connection,
                prefix: configuration.prefix ?? DEFAULT_QUEUE_PREFIX,
                concurrency: configuration.concurrency ?? 1,
            },
        );

        this.worker.on("error", () => undefined);
        this.worker.on("completed", (job) => {
            configuration.onCompleted?.(job.data);
        });
        this.worker.on("failed", (job, error) => {
            configuration.onFailed?.(job?.data, error);
        });
    }

    public async waitUntilReady(): Promise<void> {
        await this.worker.waitUntilReady();
    }

    public async close(): Promise<void> {
        await this.worker.close();
        this.connection.disconnect();
    }
}

function validateConfiguration(configuration: BullMqCollectorProcessingWorkerConfiguration): void {
    if (configuration.redisUrl.trim().length === 0) {
        throw new Error("BullMQ Redis URL is required.");
    }

    if (configuration.queueName !== undefined && configuration.queueName.trim().length === 0) {
        throw new Error("BullMQ queue name cannot be empty.");
    }

    if (configuration.prefix !== undefined && configuration.prefix.trim().length === 0) {
        throw new Error("BullMQ queue prefix cannot be empty.");
    }

    if (
        configuration.concurrency !== undefined &&
        (!Number.isSafeInteger(configuration.concurrency) || configuration.concurrency <= 0)
    ) {
        throw new Error("BullMQ worker concurrency must be a positive integer.");
    }
}
