import { Queue } from "bullmq";
import { Redis } from "ioredis";

import type {
    CollectorProcessingJob,
    IProcessingQueue,
    ProcessingQueueEnqueueResult,
} from "../domain/processing-queue.contracts.js";

const PROCESS_COLLECTOR_BATCH_JOB_NAME = "process-collector-batch";
const DEFAULT_QUEUE_NAME = "collector-processing";
const DEFAULT_QUEUE_PREFIX = "trivikrama";

export interface BullMqProcessingQueueConfiguration {
    readonly redisUrl: string;
    readonly queueName?: string;
    readonly prefix?: string;
}

export class BullMqProcessingQueue implements IProcessingQueue {
    private readonly connection: Redis;
    private readonly queue: Queue<CollectorProcessingJob>;

    public constructor(configuration: BullMqProcessingQueueConfiguration) {
        validateConfiguration(configuration);

        this.connection = new Redis(configuration.redisUrl, {
            lazyConnect: true,
            enableReadyCheck: true,
            maxRetriesPerRequest: 1,
        });

        this.connection.on("error", () => undefined);

        this.queue = new Queue<CollectorProcessingJob>(
            configuration.queueName ?? DEFAULT_QUEUE_NAME,
            {
                connection: this.connection,
                prefix: configuration.prefix ?? DEFAULT_QUEUE_PREFIX,
                defaultJobOptions: {
                    removeOnComplete: false,
                    removeOnFail: false,
                },
            },
        );
    }

    public async enqueue(job: CollectorProcessingJob): Promise<ProcessingQueueEnqueueResult> {
        const jobId = job.batchId;
        const existingJob = await this.queue.getJob(jobId);

        if (existingJob !== undefined) {
            return {
                status: "already_exists",
                jobId,
            };
        }

        await this.queue.add(PROCESS_COLLECTOR_BATCH_JOB_NAME, job, { jobId });

        return {
            status: "enqueued",
            jobId,
        };
    }

    public async close(): Promise<void> {
        await this.queue.close();
        this.connection.disconnect();
    }
}

function validateConfiguration(configuration: BullMqProcessingQueueConfiguration): void {
    if (configuration.redisUrl.trim().length === 0) {
        throw new Error("BullMQ Redis URL is required.");
    }

    if (configuration.queueName !== undefined && configuration.queueName.trim().length === 0) {
        throw new Error("BullMQ queue name cannot be empty.");
    }

    if (configuration.prefix !== undefined && configuration.prefix.trim().length === 0) {
        throw new Error("BullMQ queue prefix cannot be empty.");
    }
}
