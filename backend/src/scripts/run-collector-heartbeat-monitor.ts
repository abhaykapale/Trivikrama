import env from "../config/env.js";
import { loadCollectorHeartbeatRuntimeSettings } from "../config/collector-heartbeat.env.js";
import {
    createConfiguredCollectorHeartbeatMonitor,
    isCollectorHeartbeatError,
    isCollectorVerificationError,
} from "../modules/ingestion/index.js";
import logger from "../shared/logger/logger.js";

async function main(): Promise<void> {
    const heartbeatSettings = loadCollectorHeartbeatRuntimeSettings();
    const monitor = await createConfiguredCollectorHeartbeatMonitor({
        handoffRoot: env.collector.directory,
        collectorTrust: env.collector.trust,
        postgres: {
            connectionString: env.database.DATABASE_URL,
            poolMin: 0,
            poolMax: Math.min(2, env.database.postgres.poolMax),
            acquireConnectionTimeoutMs: env.database.postgres.connectionTimeoutMs,
            statementTimeoutMs: env.database.postgres.queryTimeoutMs,
            applicationName: "trivikrama-collector-heartbeat-monitor",
        },
        staleAfterMs: heartbeatSettings.staleAfterMs,
        maxFutureSkewMs: heartbeatSettings.maxFutureSkewMs,
    });

    const shutdownSignal = waitForShutdownSignal();

    logger.info("Collector heartbeat monitor is ready.");

    try {
        while (true) {
            await runCycle(monitor);

            const signal = await Promise.race([
                delay(heartbeatSettings.pollIntervalMs).then(() => null),
                shutdownSignal,
            ]);

            if (signal !== null) {
                logger.info(`Collector heartbeat monitor received ${signal}; stopping.`);
                break;
            }
        }
    } finally {
        await monitor.close();
    }
}

async function runCycle(
    monitor: Awaited<ReturnType<typeof createConfiguredCollectorHeartbeatMonitor>>,
): Promise<void> {
    try {
        const result = await monitor.consumeHeartbeat.execute();

        if (result.status === "updated") {
            logger.info("Collector heartbeat status updated.", {
                collectorId: result.collector.collectorId,
                status: result.collector.status,
            });
        }
    } catch (error: unknown) {
        logger.warn("Collector heartbeat was not accepted.", safeErrorContext(error));
    }

    try {
        const result = await monitor.markStaleCollectorsOffline.execute();

        if (result.markedOffline > 0) {
            logger.warn("Stale Collectors were marked offline.", {
                markedOffline: result.markedOffline,
                staleBefore: result.staleBefore.toISOString(),
            });
        }
    } catch (error: unknown) {
        logger.error("Unable to evaluate stale Collector heartbeats.", safeErrorContext(error));
    }
}

function safeErrorContext(error: unknown): Record<string, unknown> {
    if (isCollectorVerificationError(error) || isCollectorHeartbeatError(error)) {
        return { errorName: error.name, errorCode: error.code };
    }

    return { errorName: error instanceof Error ? error.name : "UnknownError" };
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

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main().catch((error: unknown) => {
    logger.error("Collector heartbeat monitor failed to start.", safeErrorContext(error));
    process.exitCode = 1;
});
