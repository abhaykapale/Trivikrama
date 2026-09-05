import type { CollectorVerificationRuntimeConfiguration } from "./configured-ingestion-verification.dependencies.js";

import { RunCollectorIntakeCycleService } from "../application/run-collector-intake-cycle.service.js";
import { VerifyAndQueueClaimedBatchService } from "../application/verify-and-queue-claimed-batch.service.js";
import { CollectorFileIntakeService } from "../infrastructure/collector-file-intake.service.js";
import { ClaimedCollectorBatchReader } from "../infrastructure/claimed-collector-batch.reader.js";
import { BullMqProcessingQueue } from "../infrastructure/bullmq-processing.queue.js";
import { createConfiguredCollectorMessageVerifier } from "./configured-ingestion-verification.dependencies.js";

export interface CollectorIntakeCycleRuntimeConfiguration {
    readonly handoffRoot: string;
    readonly redisUrl: string;
    readonly collectorTrust: CollectorVerificationRuntimeConfiguration;
}

export interface ConfiguredCollectorIntakeCycle {
    readonly runCycle: RunCollectorIntakeCycleService;

    /** Closes Redis/BullMQ resources during application shutdown. */
    close(): Promise<void>;
}

/**
 * Production composition root for one Collector intake cycle.
 *
 * This is the only place where application services are connected to concrete
 * filesystem, cryptography, and BullMQ implementations.
 */
export function createConfiguredCollectorIntakeCycle(
    configuration: CollectorIntakeCycleRuntimeConfiguration,
): ConfiguredCollectorIntakeCycle {
    const fileIntake = new CollectorFileIntakeService({
        handoffRoot: configuration.handoffRoot,
    });

    const reader = new ClaimedCollectorBatchReader({
        handoffRoot: configuration.handoffRoot,
    });

    const verifier = createConfiguredCollectorMessageVerifier(configuration.collectorTrust);

    const processingQueue = new BullMqProcessingQueue({
        redisUrl: configuration.redisUrl,
    });

    const claimedBatchProcessor = new VerifyAndQueueClaimedBatchService({
        fileIntake,
        reader,
        verifier,
        processingQueue,
    });

    return {
        runCycle: new RunCollectorIntakeCycleService({
            fileIntake,
            claimedBatchProcessor,
        }),

        async close(): Promise<void> {
            await processingQueue.close();
        },
    };
}
