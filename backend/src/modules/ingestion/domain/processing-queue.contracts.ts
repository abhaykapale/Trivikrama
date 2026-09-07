import type { Sha256Digest } from "./collector-verification.contracts.js";

export interface CollectorProcessingJob {
    readonly batchId: string;
    readonly collectorId: string;
    readonly processingFileName: string;
    readonly byteLength: number;
    readonly canonicalUnsignedSha256: Sha256Digest;
    readonly enqueuedAt: string;
}

export type ProcessingQueueEnqueueResult =
    | {
          readonly status: "enqueued";
          readonly jobId: string;
      }
    | {
          readonly status: "already_exists";
          readonly jobId: string;
      };

export interface IProcessingQueue {
    enqueue(
        job: CollectorProcessingJob,
    ): Promise<ProcessingQueueEnqueueResult>;

    close() : Promise<void>
}
