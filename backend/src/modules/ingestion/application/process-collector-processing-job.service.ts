import type { CollectorBatchQuarantineReason } from "../domain/collector-file-intake.contracts.js";
import type { CreateRawEventArchiveInput } from "../../../database/repositories/mongodb/raw-event-archive.repository.js";
import type { IClaimedCollectorBatchReader } from "../domain/claimed-collector-batch-reader.contracts.js";
import type { ICollectorMessageVerifier } from "../domain/collector-verification.contracts.js";
import { isCollectorVerificationError } from "../domain/collector-verification.errors.js";
import type { CollectorProcessingJob } from "../domain/processing-queue.contracts.js";
import type { ArchiveVerifiedCollectorBatchService } from "./archive-verified-collector-batch.service.js";
import type { ICollectorEventNormalizer } from "../domain/collector-event-normalization.contracts.js";
import type { PersistNormalizedCollectorEventsService } from "./persist-normalized-collector-events.service.js";

export type ProcessCollectorProcessingJobResult =
    | {
          readonly status: "processed";
          readonly archiveStatus: "archived" | "already_archived";
          readonly totalEvents: number;
          readonly insertedEvents: number;
          readonly alreadyPresentEvents: number;
      }
    | {
          readonly status: "quarantine";
          readonly reason: CollectorBatchQuarantineReason;
      };


export interface ProcessCollectorProcessingJobDependencies {
    readonly reader: IClaimedCollectorBatchReader;
    readonly verifier: ICollectorMessageVerifier;
    readonly rawBatchArchive: Pick<ArchiveVerifiedCollectorBatchService, "execute">;
    readonly normalizer: ICollectorEventNormalizer;
    readonly normalizedEventPersistence: Pick<PersistNormalizedCollectorEventsService, "execute">;
    readonly now: () => Date;
}

/**
 * Processes one BullMQ job. Filesystem and database failures intentionally
 * escape this service so BullMQ retries them. Integrity failures become
 * explicit quarantine outcomes for the outer worker wrapper.
 */
export class ProcessCollectorProcessingJobService {
    public constructor(private readonly dependencies: ProcessCollectorProcessingJobDependencies) {}

    public async execute(
        job: CollectorProcessingJob,
    ): Promise<ProcessCollectorProcessingJobResult> {
        const bytes = await this.dependencies.reader.read(job);

        let verified;

        try {
            verified = await this.dependencies.verifier.verify(bytes);
        } catch (error) {
            if (isCollectorVerificationError(error)) {
                return {
                    status: "quarantine",
                    reason: error.code,
                };
            }

            throw error;
        }

        const message = verified.message;

        if (message.message_type !== "event_batch") {
            return {
                status: "quarantine",
                reason: "UNSUPPORTED_MESSAGE_TYPE",
            };
        }

        if (message.collector_id !== job.collectorId) {
            return {
                status: "quarantine",
                reason: "SOURCE_IDENTITY_MISMATCH",
            };
        }

        if (message.batch_id !== job.batchId) {
            return {
                status: "quarantine",
                reason: "BATCH_ID_MISMATCH",
            };
        }

        if (verified.canonicalUnsignedSha256 !== job.canonicalUnsignedSha256) {
            return {
                status: "quarantine",
                reason: "BATCH_DIGEST_MISMATCH",
            };
        }

        const processedAt = this.dependencies.now();
        const archiveInput: CreateRawEventArchiveInput = {
            batch_id: message.batch_id,
            collector_id: message.collector_id,
            canonical_unsigned_sha256: verified.canonicalUnsignedSha256,
            event_count: message.event_count,
            schema_version: message.ocsf_schema_version,
            // Preserve the complete verified Collector event, including source
            // position and raw payload, for forensic investigation.
            events: message.events.map(
                (event) => ({ ...event }) as unknown as Record<string, unknown>,
            ),
            file_size_bytes: job.byteLength,
            archived_at: processedAt,
        };

        const archiveResult = await this.dependencies.rawBatchArchive.execute(archiveInput);

        if (archiveResult.status === "batch_id_collision") {
            return {
                status: "quarantine",
                reason: "BATCH_ID_COLLISION",
            };
        }

        const normalized = this.dependencies.normalizer.normalize(
            message,
            processedAt,
        );
        const persistenceResult = await this.dependencies.normalizedEventPersistence.execute(
            normalized.events,
        );

        if (persistenceResult.status === "event_id_collision") {
            return {
                status: "quarantine",
                reason: "EVENT_ID_COLLISION",
            };
        }

        return {
            status: "processed",
            archiveStatus: archiveResult.status,
            totalEvents: normalized.stats.totalEvents,
            insertedEvents: persistenceResult.insertedCount,
            alreadyPresentEvents: persistenceResult.alreadyPresentCount,
        };
    }
}
