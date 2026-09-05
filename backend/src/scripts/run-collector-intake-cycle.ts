import env from "../config/env.js";
import { createConfiguredCollectorIntakeCycle } from "../modules/ingestion/index.js";
import logger from "../shared/logger/logger.js";

async function main(): Promise<void> {
    const intakeCycle = createConfiguredCollectorIntakeCycle({
        handoffRoot: env.collector.directory,
        redisUrl: env.database.REDIS_URL,
        collectorTrust: env.collector.trust,
    });

    try {
        const report = await intakeCycle.runCycle.execute();

        const processing = {
            enqueued: 0,
            alreadyExists: 0,
            quarantined: 0,
            retryableFailures: 0,
        };

        for (const outcome of report.processed) {
            if (!("result" in outcome)) {
                processing.retryableFailures += 1;
                continue;
            }

            if (outcome.result.status === "enqueued") {
                processing.enqueued += 1;
                continue;
            }

            if (outcome.result.status === "already_exists") {
                processing.alreadyExists += 1;
                continue;
            }

            processing.quarantined += 1;
        }

        logger.info(
            JSON.stringify(
                {
                    recovery: {
                        recovered: report.recovery.recovered.length,
                        precheckQuarantined: report.recovery.quarantined.length,
                        ignored: report.recovery.ignored.length,
                    },
                    discovery: {
                        claimed: report.discovery.claimed.length,
                        precheckQuarantined: report.discovery.quarantined.length,
                        ignored: report.discovery.ignored.length,
                    },
                    processing,
                },
                null,
                2,
            ),
        );
    } finally {
        await intakeCycle.close();
    }
}

void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";

    console.error(`Collector intake cycle failed: ${errorName}`);

    process.exitCode = 1;
});
