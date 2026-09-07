import {
    closeMongoDb,
    connectMongoDb,
    createMongoDbClient,
    type MongoDbClientOptions,
} from "../../../database/mongodb/client.js";
import { createMongoRepositories } from "../../../database/repositories/mongodb/mongo-repository.factory.js";
import { ArchiveVerifiedCollectorBatchService } from "../application/archive-verified-collector-batch.service.js";
import { HandleCollectorProcessingJobService } from "../application/handle-collector-processing-job.service.js";
import { ProcessCollectorProcessingJobService } from "../application/process-collector-processing-job.service.js";
import { BullMqCollectorProcessingWorker } from "../infrastructure/bullmq-collector-processing.worker.js";
import { ClaimedCollectorBatchReader } from "../infrastructure/claimed-collector-batch.reader.js";
import { CollectorFileIntakeService } from "../infrastructure/collector-file-intake.service.js";
import type { CollectorVerificationRuntimeConfiguration } from "./configured-ingestion-verification.dependencies.js";
import { createConfiguredCollectorMessageVerifier } from "./configured-ingestion-verification.dependencies.js";

export interface CollectorProcessingWorkerRuntimeConfiguration {
    readonly handoffRoot: string;
    readonly redisUrl: string;
    readonly mongo: MongoDbClientOptions;
    readonly collectorTrust: CollectorVerificationRuntimeConfiguration;
}

export interface ConfiguredCollectorProcessingWorker {
    readonly worker: BullMqCollectorProcessingWorker;
    close(): Promise<void>;
}

/**
 * Production composition root for the long-running Collector processing worker.
 */
export async function createConfiguredCollectorProcessingWorker(
    configuration: CollectorProcessingWorkerRuntimeConfiguration,
): Promise<ConfiguredCollectorProcessingWorker> {
    const mongoClient = createMongoDbClient();
    let worker: BullMqCollectorProcessingWorker | undefined;

    try {
        await connectMongoDb(mongoClient, configuration.mongo);

        const repositories = createMongoRepositories(mongoClient);

        const fileIntake = new CollectorFileIntakeService({
            handoffRoot: configuration.handoffRoot,
        });

        const reader = new ClaimedCollectorBatchReader({
            handoffRoot: configuration.handoffRoot,
        });

        const verifier = createConfiguredCollectorMessageVerifier(configuration.collectorTrust);

        const rawBatchArchive = new ArchiveVerifiedCollectorBatchService({
            rawEventArchive: repositories.rawEventArchive,
        });

        const processor = new ProcessCollectorProcessingJobService({
            reader,
            verifier,
            rawBatchArchive,
        });

        const jobHandler = new HandleCollectorProcessingJobService({
            processor,
            fileIntake,
        });

        worker = new BullMqCollectorProcessingWorker(
            {
                redisUrl: configuration.redisUrl,
            },
            {
                jobHandler,
            },
        );

        await worker.waitUntilReady();
            const ConfiguredWorker = worker;
        return {
            worker : ConfiguredWorker,

            async close(): Promise<void> {
                try {
                    await ConfiguredWorker.close();
                } finally {
                    await closeMongoDb(mongoClient);
                }
            },
        };
    } catch (error) {
        await Promise.allSettled([
            worker === undefined ? Promise.resolve() : worker.close(),
            closeMongoDb(mongoClient),
        ]);

        throw error;
    }
}
