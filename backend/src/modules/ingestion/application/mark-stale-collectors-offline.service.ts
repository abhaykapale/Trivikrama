import type { ICollectorStatusRepository } from "../../../database/repositories/collector-status/collector-status.repository.js";
import {
    COLLECTOR_HEARTBEAT_ERROR_CODES,
    CollectorHeartbeatError,
} from "../domain/collector-heartbeat.errors.js";

const DEFAULT_STALE_AFTER_MS = 90 * 1000;

export interface MarkStaleCollectorsOfflineDependencies {
    readonly collectorStatuses: Pick<ICollectorStatusRepository, "markStaleOffline">;
    readonly now: () => Date;
    readonly staleAfterMs?: number;
    readonly orgId?: string;
}

export interface MarkStaleCollectorsOfflineResult {
    readonly staleBefore: Date;
    readonly markedOffline: number;
}

export class MarkStaleCollectorsOfflineService {
    private readonly staleAfterMs: number;

    public constructor(private readonly dependencies: MarkStaleCollectorsOfflineDependencies) {
        this.staleAfterMs = dependencies.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

        if (!Number.isSafeInteger(this.staleAfterMs) || this.staleAfterMs <= 0) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.INVALID_CONFIGURATION,
                "staleAfterMs must be a positive safe integer.",
            );
        }
    }

    public async execute(): Promise<MarkStaleCollectorsOfflineResult> {
        const staleBefore = new Date(this.dependencies.now().getTime() - this.staleAfterMs);
        const markedOffline = await this.dependencies.collectorStatuses.markStaleOffline(
            staleBefore,
            this.dependencies.orgId,
        );

        return { staleBefore, markedOffline };
    }
}
