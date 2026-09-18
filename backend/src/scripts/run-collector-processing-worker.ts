import env from "../config/env.js";
import { createConfiguredCollectorProcessingWorker } from "../modules/ingestion/index.js";
import logger from "../shared/logger/logger.js";

async function main(): Promise<void> {
    const configuredWorker = await createConfiguredCollectorProcessingWorker({
        organizationId: env.collector.organizationId ?? "default",
        handoffRoot: env.collector.directory,
        redisUrl: env.database.REDIS_URL,
        redisKeyPrefix: env.database.redis.keyPrefix,
        mongo: {
            uri: env.database.MONGODB_URI,
            maxPoolSize: env.database.mongodb.poolSize,
            serverSelectionTimeoutMs: env.database.mongodb.serverSelectionTimeoutMs,
        },
        postgres: {
            connectionString: env.database.DATABASE_URL,
            poolMin: env.database.postgres.poolMin,
            poolMax: env.database.postgres.poolMax,
            acquireConnectionTimeoutMs: env.database.postgres.connectionTimeoutMs,
            statementTimeoutMs: env.database.postgres.queryTimeoutMs,
            applicationName: "trivikrama-collector-processing-worker",
        },
        collectorTrust: env.collector.trust,
    });

    logger.info("Collector processing worker is ready and waiting for BullMQ jobs.");

    const signal = await waitForShutdownSignal();

    logger.info(`Collector processing worker received ${signal}; stopping.`);

    await configuredWorker.close();
}

function waitForShutdownSignal(): Promise<"SIGINT" | "SIGTERM"> {
    return new Promise((resolve) => {
        const stop = (signal: "SIGINT" | "SIGTERM"): void => {
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
            resolve(signal);
        };

        const onSigint = (): void => stop("SIGINT");
        const onSigterm = (): void => stop("SIGTERM");

        process.once("SIGINT", onSigint);
        process.once("SIGTERM", onSigterm);
    });
}

void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";

    console.error(`Collector processing worker failed: ${errorName}`);

    process.exitCode = 1;
});
