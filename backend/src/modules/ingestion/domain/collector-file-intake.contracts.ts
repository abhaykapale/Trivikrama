import type { CollectorVerificationErrorCode } from "./collector-verification.errors.js";
import { CollectorProcessingJob } from "./processing-queue.contracts.js";
// -----------------------------------------------------------------------------
// Collector handoff layout
// -----------------------------------------------------------------------------

/**
 * ARCH-01 limits a signed batch envelope to eight mebibytes. The limit is
 * enforced from file metadata before the backend reads or parses its bytes.
 */
export const MAX_COLLECTOR_BATCH_BYTES = 8 * 1024 * 1024;

export interface CollectorFileIntakeConfiguration {
    /** The backend-owned ARCH-01 handoff root (COLLECTOR_DIR). */
    readonly handoffRoot: string;

    /** Allows a smaller limit in tests; production must not exceed ARCH-01. */
    readonly maxBatchBytes?: number;
}

export type CollectorIntakeIgnoredFileReason =
    | "INVALID_COLLECTOR_DIRECTORY"
    | "NON_DIRECTORY_COLLECTOR_ENTRY"
    | "TEMPORARY_OR_UNRECOGNIZED_FILE"
    | "SYMLINK_NOT_ALLOWED"
    | "NON_REGULAR_FILE"
    | "CLAIM_RACE_LOST"
    | "MALFORMED_PROCESSING_FILE";

export interface IgnoredCollectorFile {
    readonly relativePath: string;
    readonly reason: CollectorIntakeIgnoredFileReason;
}

export type CollectorBatchQuarantineReason =
    | "EMPTY_FILE"
    | CollectorVerificationErrorCode
    | "BATCH_DIGEST_MISMATCH"
    | "BATCH_ID_COLLISION"
    | "EVENT_ID_COLLISION";

export interface ClaimedCollectorBatchFile {
    readonly collectorId: string;
    readonly batchId: string;
    readonly claimId: string;
    readonly originalFileName: string;
    readonly processingFileName: string;
    readonly processingPath: string;
    readonly byteLength: number;
    /** Null when a backend restart recovered a previously claimed file. */
    readonly claimedAt: string | null;
}

export interface QuarantinedCollectorBatchFile extends ClaimedCollectorBatchFile {
    readonly quarantineFileName: string;
    readonly quarantinePath: string;
    readonly quarantineReason: CollectorBatchQuarantineReason;
    readonly quarantinedAt: string;
}

export type CompleteCollectorProcessingJobResult =
    | {
          readonly status: "completed";
          readonly processedPath: string;
      }
    | {
          readonly status: "already_completed";
          readonly processedPath: string;
      };

export interface CollectorFileIntakeReport {
    readonly claimed: readonly ClaimedCollectorBatchFile[];
    readonly quarantined: readonly QuarantinedCollectorBatchFile[];
    readonly ignored: readonly IgnoredCollectorFile[];
}

export interface CollectorFileRecoveryReport {
    readonly recovered: readonly ClaimedCollectorBatchFile[];
    readonly quarantined: readonly QuarantinedCollectorBatchFile[];
    readonly ignored: readonly IgnoredCollectorFile[];
}

/**
 * Claims published files only. It deliberately does not parse, verify, queue,
 * archive, or delete a batch; those responsibilities belong to later BE-ING
 * parts.
 */
export interface ICollectorFileIntake {
    initialize(): Promise<void>;

    claimPublishedBatches(): Promise<CollectorFileIntakeReport>;

    recoverClaimedBatches(): Promise<CollectorFileRecoveryReport>;

    quarantineClaimedBatch(
        claimedFile: ClaimedCollectorBatchFile,
        reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile>;

    quarantineProcessingJob(
        job: CollectorProcessingJob,
        reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile>;
}

/** Worker-owned terminal filesystem actions after a job decision. */
export interface ICollectorProcessingFileLifecycle {
    quarantineProcessingJob(
        job: CollectorProcessingJob,
        reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile>;

    completeProcessingJob(
        job: CollectorProcessingJob,
    ): Promise<CompleteCollectorProcessingJobResult>;
}


