import type {
    ClaimedCollectorBatchFile,
    CollectorBatchQuarantineReason,
    ICollectorFileIntake,
} from "../domain/collector-file-intake.contracts.js";
import type { IClaimedCollectorBatchReader } from "../domain/claimed-collector-batch-reader.contracts.js";
import type { ICollectorMessageVerifier } from "../domain/collector-verification.contracts.js";
import { isCollectorVerificationError } from "../domain/collector-verification.errors.js";
import type { IProcessingQueue } from "../domain/processing-queue.contracts.js";

export type VerifyAndQueueClaimedBatchResult =
    | {
          readonly status: "enqueued";
          readonly jobId: string;
      }
    | {
          readonly status: "already_exists";
          readonly jobId: string;
      }
    | {
          readonly status: "quarantined";
          readonly reason: CollectorBatchQuarantineReason;
      };

export interface VerifyAndQueueClaimedBatchDependencies {
    readonly fileIntake: ICollectorFileIntake;
    readonly reader: IClaimedCollectorBatchReader;
    readonly verifier: ICollectorMessageVerifier;
    readonly processingQueue: IProcessingQueue;
}

export interface IClaimedCollectorBatchProcessor {
    execute(claimedFile: ClaimedCollectorBatchFile): Promise<VerifyAndQueueClaimedBatchResult>;
}

/**
 * Application service for one already claimed file.
 *
 * Filesystem failures and Redis failures are rethrown for retry.
 * Collector contract failures are terminal and move the file to quarantine.
 */
export class VerifyAndQueueClaimedBatchService implements IClaimedCollectorBatchProcessor {
    public constructor(private readonly dependencies: VerifyAndQueueClaimedBatchDependencies) {}

    public async execute(
        claimedFile: ClaimedCollectorBatchFile,
    ): Promise<VerifyAndQueueClaimedBatchResult> {
        const bytes = await this.dependencies.reader.read(claimedFile);

        try {
            const verified = await this.dependencies.verifier.verify(bytes);
            const message = verified.message;

            if (message.message_type !== "event_batch") {
                return this.quarantine(claimedFile, "UNSUPPORTED_MESSAGE_TYPE");
            }

            if (message.collector_id !== claimedFile.collectorId) {
                return this.quarantine(claimedFile, "SOURCE_IDENTITY_MISMATCH");
            }

            if (message.batch_id !== claimedFile.batchId) {
                return this.quarantine(claimedFile, "BATCH_ID_MISMATCH");
            }

            const queueResult = await this.dependencies.processingQueue.enqueue({

                batchId: message.batch_id,
                collectorId: message.collector_id,
                processingFileName: claimedFile.processingFileName,
                byteLength: claimedFile.byteLength,
                canonicalUnsignedSha256: verified.canonicalUnsignedSha256,
                enqueuedAt: new Date().toISOString(),
            });

            return queueResult.status === "enqueued"
                ? {
                      status: "enqueued",
                      jobId: queueResult.jobId,
                  }
                : {
                      status: "already_exists",
                      jobId: queueResult.jobId,
                  };
        } catch (error) {
            if (isCollectorVerificationError(error)) {
                return this.quarantine(claimedFile, error.code);
            }

            throw error;
        }
    }

    private async quarantine(
        claimedFile: ClaimedCollectorBatchFile,
        reason: CollectorBatchQuarantineReason,
    ): Promise<VerifyAndQueueClaimedBatchResult> {
        await this.dependencies.fileIntake.quarantineClaimedBatch(claimedFile, reason);

        return {
            status: "quarantined",
            reason,
        };
    }
}
