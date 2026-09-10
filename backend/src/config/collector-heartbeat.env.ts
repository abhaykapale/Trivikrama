import { z } from "zod";

const heartbeatEnvironmentSchema = z.object({
    COLLECTOR_HEARTBEAT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    COLLECTOR_HEARTBEAT_STALE_AFTER_MS: z.coerce.number().int().positive().default(90000),
    COLLECTOR_HEARTBEAT_MAX_FUTURE_SKEW_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(120000),
});

export interface CollectorHeartbeatRuntimeSettings {
    readonly pollIntervalMs: number;
    readonly staleAfterMs: number;
    readonly maxFutureSkewMs: number;
}

export function loadCollectorHeartbeatRuntimeSettings(
    source: NodeJS.ProcessEnv = process.env,
): CollectorHeartbeatRuntimeSettings {
    const parsed = heartbeatEnvironmentSchema.safeParse(source);

    if (!parsed.success) {
        const violations = parsed.error.issues.map((issue) => {
            const field = issue.path.length > 0 ? String(issue.path[0]) : "environment";
            return `${field} ${issue.message}`;
        });

        throw new Error(`Collector heartbeat configuration failed: ${violations.join("; ")}`);
    }

    return {
        pollIntervalMs: parsed.data.COLLECTOR_HEARTBEAT_POLL_INTERVAL_MS,
        staleAfterMs: parsed.data.COLLECTOR_HEARTBEAT_STALE_AFTER_MS,
        maxFutureSkewMs: parsed.data.COLLECTOR_HEARTBEAT_MAX_FUTURE_SKEW_MS,
    };
}

