import {
    closePostgres,
    createPostgresClient,
    pingPostgres,
    type PostgresClient,
    type PostgresClientOptions,
} from "../../../database/postgres/client.js";
import { PostgresCollectorStatusRepository } from "../../../database/repositories/collector-status/postgres-collector-status.repository.js";
import { ConsumeCollectorHeartbeatService } from "../application/consume-collector-heartbeat.service.js";
import { MarkStaleCollectorsOfflineService } from "../application/mark-stale-collectors-offline.service.js";
import { CollectorHeartbeatFileReader } from "../infrastructure/collector-heartbeat-file.reader.js";
import type { CollectorVerificationRuntimeConfiguration } from "./configured-ingestion-verification.dependencies.js";
import { createConfiguredCollectorMessageVerifier } from "./configured-ingestion-verification.dependencies.js";

export interface CollectorHeartbeatMonitorRuntimeConfiguration {
    readonly handoffRoot: string;
    readonly collectorTrust: CollectorVerificationRuntimeConfiguration;
    readonly postgres: PostgresClientOptions;
    readonly staleAfterMs: number;
    readonly maxFutureSkewMs: number;
    readonly orgId?: string;
}

export interface ConfiguredCollectorHeartbeatMonitor {
    readonly postgres: PostgresClient;
    readonly consumeHeartbeat: ConsumeCollectorHeartbeatService;
    readonly markStaleCollectorsOffline: MarkStaleCollectorsOfflineService;
    close(): Promise<void>;
}

/** Production composition root for the long-running heartbeat monitor. */
export async function createConfiguredCollectorHeartbeatMonitor(
    configuration: CollectorHeartbeatMonitorRuntimeConfiguration,
): Promise<ConfiguredCollectorHeartbeatMonitor> {
    const postgres = createPostgresClient(configuration.postgres);

    try {
        await pingPostgres(postgres);

        const collectorStatuses = new PostgresCollectorStatusRepository(postgres);
        const reader = new CollectorHeartbeatFileReader({
            handoffRoot: configuration.handoffRoot,
            collectorId: configuration.collectorTrust.collectorId,
        });
        const verifier = createConfiguredCollectorMessageVerifier(configuration.collectorTrust);
        const now = (): Date => new Date();

        return {
            postgres,
            consumeHeartbeat: new ConsumeCollectorHeartbeatService({
                expectedCollectorId: configuration.collectorTrust.collectorId,
                reader,
                verifier,
                collectorStatuses,
                now,
                maxFutureSkewMs: configuration.maxFutureSkewMs,
                orgId: configuration.orgId,
            }),
            markStaleCollectorsOffline: new MarkStaleCollectorsOfflineService({
                collectorStatuses,
                now,
                staleAfterMs: configuration.staleAfterMs,
                orgId: configuration.orgId,
            }),
            close: () => closePostgres(postgres),
        };
    } catch (error: unknown) {
        await closePostgres(postgres).catch(() => undefined);
        throw error;
    }
}
