import type {
    CollectorProcessingJob,
    IProcessingQueue,
    ProcessingQueueEnqueueResult,
} from "../domain/processing-queue.contracts.js";

export class InMemoryProcessingQueue implements IProcessingQueue {
    private readonly jobs = new Map<string, CollectorProcessingJob>();

    public async enqueue(job: CollectorProcessingJob): Promise<ProcessingQueueEnqueueResult> {
        const jobId = job.batchId;

        if (this.jobs.has(jobId)) {
            return {
                status: "already_exists",
                jobId,
            };
        }

        this.jobs.set(jobId, { ...job });

        return {
            status: "enqueued",
            jobId,
        };
    }

    public async close(): Promise<void> {
        this.jobs.clear();
    }
}
