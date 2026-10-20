import { randomUUID } from "node:crypto";

import {
    closeMongoDb,
    connectMongoDb,
    createMongoDbClient,
    type MongoDbClientOptions,
} from "../../../database/mongodb/client.js";
import {
    closePostgres,
    createPostgresClient,
    pingPostgres,
    type PostgresClientOptions,
} from "../../../database/postgres/client.js";
import {
    closeRedis,
    connectRedis,
    createRedisClient,
} from "../../../database/redis/client.js";
import { createPostgresRepositories } from "../../../database/repositories/postgres-repository.factory.js";
import { createPostgresUnitOfWork } from "../../../database/transactions/postgres-unit-of-work.js";
import { createMongoRepositories } from "../../../database/repositories/mongodb/mongo-repository.factory.js";
import {
    createOrganizationRuleEngine,
    EvaluateAndPersistRuleAlertsService,
    PersistRuleAlertsService,
} from "../../detection/index.js";
import {
    BatchEntropyVolumeFeatureExtractor,
    DeterministicFeatureExtractor,
    FeatureExtractorPluginAdapter,
    PassthroughFeatureExtractor,
    PluginFeatureExtractor,
    RedisBackedFeatureExtractor,
    RedisBackedAuthenticationFeatureExtractor,
    RedisBackedProcessFeatureExtractor,
    RedisBackedNetworkFeatureExtractor,
    RedisAuthenticationFeatureStore,
    RedisProcessFeatureStore,
    RedisNetworkFeatureStore,
    RedisTemporalFrequencyFeatureStore,
} from "../../feature-extraction/index.js";
import {
    DetectAndPersistAiResultsService,
    HttpAiClient,
    type HttpAiClientConfiguration,
} from "../../analysis/index.js";
import {
    IncidentNotificationDispatcher,
    IncidentNotificationDispatcherRunner,
    PostgresIncidentCorrelationUnitOfWork,
    RedisIncidentNotificationPublisher,
    TransactionalIncidentCorrelator,
} from "../../incidents/index.js";
import { ArchiveVerifiedCollectorBatchService } from "../application/archive-verified-collector-batch.service.js";
import { HandleCollectorProcessingJobService } from "../application/handle-collector-processing-job.service.js";
import { ProcessCollectorProcessingJobService } from "../application/process-collector-processing-job.service.js";
import { PersistNormalizedCollectorEventsService } from "../application/persist-normalized-collector-events.service.js";
import { BullMqCollectorProcessingWorker } from "../infrastructure/bullmq-collector-processing.worker.js";
import { ClaimedCollectorBatchReader } from "../infrastructure/claimed-collector-batch.reader.js";
import { CollectorFileIntakeService } from "../infrastructure/collector-file-intake.service.js";
import { OcsfCollectorEventNormalizer } from "../infrastructure/ocsf-collector-event.normalizer.js";
import type { CollectorVerificationRuntimeConfiguration } from "./configured-ingestion-verification.dependencies.js";
import { createConfiguredCollectorMessageVerifier } from "./configured-ingestion-verification.dependencies.js";

export interface CollectorProcessingWorkerRuntimeConfiguration {
    readonly organizationId: string;
    readonly handoffRoot: string;
    readonly redisUrl: string;
    readonly redisKeyPrefix?: string;
    readonly mongo: MongoDbClientOptions;
    readonly postgres: PostgresClientOptions;
    readonly collectorTrust: CollectorVerificationRuntimeConfiguration;
    readonly ai: HttpAiClientConfiguration;
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
    const postgresClient = createPostgresClient(configuration.postgres);
    const redisClient = createRedisClient({
        url: configuration.redisUrl,
        keyPrefix: configuration.redisKeyPrefix,
    });
    let worker: BullMqCollectorProcessingWorker | undefined;
    let notificationRunner: IncidentNotificationDispatcherRunner | undefined;

    try {
        await connectMongoDb(mongoClient, configuration.mongo);
        await Promise.all([
            pingPostgres(postgresClient),
            connectRedis(redisClient),
        ]);

        const mongoRepositories = createMongoRepositories(mongoClient);
        const postgresRepositories = createPostgresRepositories(postgresClient);

        const fileIntake = new CollectorFileIntakeService({
            handoffRoot: configuration.handoffRoot,
        });

        const reader = new ClaimedCollectorBatchReader({
            handoffRoot: configuration.handoffRoot,
        });

        const verifier = createConfiguredCollectorMessageVerifier(configuration.collectorTrust);

        const rawBatchArchive = new ArchiveVerifiedCollectorBatchService({
            rawEventArchive: mongoRepositories.rawEventArchive,
        });

        const normalizer = new OcsfCollectorEventNormalizer(configuration.organizationId);
        const normalizedEventPersistence = new PersistNormalizedCollectorEventsService({
            normalizedEvents: mongoRepositories.normalizedEvents,
        });
        const passthrough = new PassthroughFeatureExtractor();
        const featureExtractor = new PluginFeatureExtractor({
            base: new DeterministicFeatureExtractor(),
            plugins: [
                new FeatureExtractorPluginAdapter({
                    name: "temporal-frequency",
                    extractor: new RedisBackedFeatureExtractor({
                        deterministic: passthrough,
                        history: new RedisTemporalFrequencyFeatureStore(redisClient),
                    }),
                }),
                new FeatureExtractorPluginAdapter({
                    name: "batch-entropy-volume",
                    extractor: new BatchEntropyVolumeFeatureExtractor({ delegate: passthrough }),
                }),
                new FeatureExtractorPluginAdapter({
                    name: "authentication",
                    applicableClasses: [3002],
                    extractor: new RedisBackedAuthenticationFeatureExtractor({
                        delegate: passthrough,
                        authenticationHistory: new RedisAuthenticationFeatureStore(redisClient),
                    }),
                }),
                new FeatureExtractorPluginAdapter({
                    name: "process",
                    applicableClasses: [1007],
                    extractor: new RedisBackedProcessFeatureExtractor({
                        delegate: passthrough,
                        processHistory: new RedisProcessFeatureStore(redisClient),
                    }),
                }),
                new FeatureExtractorPluginAdapter({
                    name: "network",
                    applicableClasses: [4001, 4003],
                    extractor: new RedisBackedNetworkFeatureExtractor({
                        delegate: passthrough,
                        networkHistory: new RedisNetworkFeatureStore(redisClient),
                    }),
                }),
            ],
        });
        const ruleEngine = await createOrganizationRuleEngine({
            organizationId: configuration.organizationId,
            ruleRepository: postgresRepositories.rules,
            redisClient,
            countWindowKeyPrefix: "detection:count:v1",
            alertCooldownKeyPrefix: "detection:cooldown:v1",
        });
        const detection = new EvaluateAndPersistRuleAlertsService({
            organizationId: configuration.organizationId,
            ruleEngine,
            alertPersistence: new PersistRuleAlertsService({
                alerts: postgresRepositories.alerts,
            }),
        });
        const aiDetection = new DetectAndPersistAiResultsService({
            organizationId: configuration.organizationId,
            client: new HttpAiClient(configuration.ai),
            results: mongoRepositories.aiResults,
            now: () => new Date(),
        });
        const incidentCorrelation = new TransactionalIncidentCorrelator({
            unitOfWork: new PostgresIncidentCorrelationUnitOfWork(
                createPostgresUnitOfWork(postgresClient),
            ),
        });
        const notificationDispatcher = new IncidentNotificationDispatcher({
            outbox: postgresRepositories.incidentNotificationOutbox,
            publisher: new RedisIncidentNotificationPublisher(redisClient),
            owner: `collector-processing-worker:${process.pid}:${randomUUID()}`,
        });
        notificationRunner = new IncidentNotificationDispatcherRunner(
            notificationDispatcher,
        );

        const processor = new ProcessCollectorProcessingJobService({
            reader,
            verifier,
            rawBatchArchive,
            normalizer,
            normalizedEventPersistence,
            featureExtractor,
            detection,
            aiDetection,
            incidentCorrelation,
            now: () => new Date(),
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
        notificationRunner.start();
        const startedWorker = worker;
        const startedNotificationRunner = notificationRunner;

        return {
            worker: startedWorker,

            async close(): Promise<void> {
                await Promise.allSettled([
                    startedNotificationRunner.close(),
                    startedWorker.close(),
                ]);
                await Promise.allSettled([
                    closeMongoDb(mongoClient),
                    closePostgres(postgresClient),
                    closeRedis(redisClient),
                ]);
            },
        };
    } catch (error) {
        await Promise.allSettled([
            worker === undefined ? Promise.resolve() : worker.close(),
            notificationRunner === undefined
                ? Promise.resolve()
                : notificationRunner.close(),
        ]);
        await Promise.allSettled([
            closeMongoDb(mongoClient),
            closePostgres(postgresClient),
            closeRedis(redisClient),
        ]);

        throw error;
    }
}
