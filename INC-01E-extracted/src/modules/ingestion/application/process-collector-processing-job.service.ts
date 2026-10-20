import type { CollectorBatchQuarantineReason } from "../domain/collector-file-intake.contracts.js";
import type { CreateRawEventArchiveInput } from "../../../database/repositories/mongodb/raw-event-archive.repository.js";
import type { IClaimedCollectorBatchReader } from "../domain/claimed-collector-batch-reader.contracts.js";
import type { ICollectorMessageVerifier } from "../domain/collector-verification.contracts.js";
import { isCollectorVerificationError } from "../domain/collector-verification.errors.js";
import type { CollectorProcessingJob } from "../domain/processing-queue.contracts.js";
import type { ArchiveVerifiedCollectorBatchService } from "./archive-verified-collector-batch.service.js";
import type { ICollectorEventNormalizer } from "../domain/collector-event-normalization.contracts.js";
import type { PersistNormalizedCollectorEventsService } from "./persist-normalized-collector-events.service.js";
import type { EvaluateAndPersistRuleAlertsService } from "../../detection/application/evaluate-and-persist-rule-alerts.service.js";
import type { IFeatureExtractor } from "../../feature-extraction/domain/feature-extraction.contracts.js";
import type { DetectAndPersistAiResultsService } from "../../analysis/application/detect-and-persist-ai-results.service.js";
import type { TransactionalIncidentCorrelator } from "../../incidents/application/transactional-incident-correlator.js";

export type ProcessCollectorProcessingJobResult =
    | {
          readonly status: "processed";
          readonly archiveStatus: "archived" | "already_archived";
          readonly totalEvents: number;
          readonly insertedEvents: number;
          readonly alreadyPresentEvents: number;
          readonly generatedAlerts: number;
          readonly insertedAlerts: number;
          readonly alreadyPresentAlerts: number;
          readonly aiEventsScored: number;
          readonly aiAnomaliesDetected: number;
          readonly insertedAiResults: number;
          readonly alreadyPresentAiResults: number;
          readonly aiUsedFallback: boolean;
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
    readonly featureExtractor: IFeatureExtractor;
    readonly detection: Pick<EvaluateAndPersistRuleAlertsService, "execute">;
    readonly aiDetection: Pick<DetectAndPersistAiResultsService, "execute">;
    readonly incidentCorrelation?: Pick<TransactionalIncidentCorrelator, "correlate">;
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
        const featureExtraction = await this.dependencies.featureExtractor.extract(
            normalized.events,
        );
        const persistenceResult = await this.dependencies.normalizedEventPersistence.execute(
            featureExtraction.events,
        );

        if (persistenceResult.status === "event_id_collision") {
            return {
                status: "quarantine",
                reason: "EVENT_ID_COLLISION",
            };
        }

        // Evaluate every normalized event, including MongoDB replays. The rule
        // engine and alert repository use stable event/alert identities, so a
        // worker retry can finish alert persistence after an earlier partial
        // execution without losing or duplicating an alert.
        const detectionResult = await this.dependencies.detection.execute(
            featureExtraction.events,
        );
        // AI is additive: its client converts transport, timeout, and open-circuit
        // failures into a fallback result, so successful rule detection is never
        // discarded merely because the inference service is unavailable.
        const aiDetectionResult = await this.dependencies.aiDetection.execute(
            featureExtraction.events,
        );

        if (this.dependencies.incidentCorrelation !== undefined) {
            if (detectionResult.records === undefined || aiDetectionResult.results === undefined) {
                throw new Error("Incident correlation requires persisted rule and AI records.");
            }
            await this.dependencies.incidentCorrelation.correlate({
                orgId: featureExtraction.events[0]?.org_id ?? "default",
                ruleAlerts: detectionResult.records,
                aiResults: aiDetectionResult.results,
                events: featureExtraction.events,
                evaluatedAt: processedAt,
            });
        }

        return {
            status: "processed",
            archiveStatus: archiveResult.status,
            totalEvents: normalized.stats.totalEvents,
            insertedEvents: persistenceResult.insertedCount,
            alreadyPresentEvents: persistenceResult.alreadyPresentCount,
            generatedAlerts: detectionResult.evaluation.alertsGenerated,
            insertedAlerts: detectionResult.insertedAlerts,
            alreadyPresentAlerts: detectionResult.alreadyPresentAlerts,
            aiEventsScored: aiDetectionResult.eventsScored,
            aiAnomaliesDetected: aiDetectionResult.anomaliesDetected,
            insertedAiResults: aiDetectionResult.insertedResults,
            alreadyPresentAiResults: aiDetectionResult.alreadyPresentResults,
            aiUsedFallback: aiDetectionResult.usedFallback,
        };
    }
}
