import { createHash } from "node:crypto";

import type {
    INetworkFeatureStore,
    NetworkFeatureSnapshot,
    RecordNetworkFeatureInput,
} from "../domain/network-feature-store.contracts.js";

interface RedisEvalClient {
    eval(
        script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown>;
}

const DAY_MS = 86_400_000;
const SNAPSHOT_TTL_MS = 7 * DAY_MS;

const RECORD_NETWORK_FEATURES_SCRIPT = `
local snapshot_key = KEYS[1]
local all_ports_key = KEYS[2]
local destination_port_key = KEYS[3]

local cached = redis.call('GET', snapshot_key)
if cached then
  return {1, cached}
end

local now_ms = tonumber(ARGV[1])
local event_member = ARGV[2]
local snapshot_ttl_ms = tonumber(ARGV[3])
local cutoff_ms = now_ms - 86400000

redis.call('ZREMRANGEBYSCORE', all_ports_key, '-inf', cutoff_ms)
redis.call('ZREMRANGEBYSCORE', destination_port_key, '-inf', cutoff_ms)

local total_before = redis.call('ZCOUNT', all_ports_key, cutoff_ms + 1, now_ms)
local port_before = redis.call('ZCOUNT', destination_port_key, cutoff_ms + 1, now_ms)
local rarity = 1
if total_before > 0 then
  rarity = 1 - (port_before / total_before)
end

redis.call('ZADD', all_ports_key, 'NX', now_ms, event_member)
redis.call('ZADD', destination_port_key, 'NX', now_ms, event_member)
redis.call('PEXPIRE', all_ports_key, 86400000)
redis.call('PEXPIRE', destination_port_key, 86400000)

local encoded = cjson.encode(rarity)
redis.call('PSETEX', snapshot_key, snapshot_ttl_ms, encoded)
return {0, encoded}
`;

export interface RedisNetworkFeatureStoreOptions {
    readonly keyPrefix?: string;
    readonly snapshotTtlMs?: number;
}

/** Atomic, replay-safe destination-port history scoped to organization and source. */
export class RedisNetworkFeatureStore implements INetworkFeatureStore {
    private readonly keyPrefix: string;
    private readonly snapshotTtlMs: number;

    public constructor(
        private readonly redis: RedisEvalClient,
        options: RedisNetworkFeatureStoreOptions = {},
    ) {
        this.keyPrefix = options.keyPrefix?.trim() || "features:network:v1";
        this.snapshotTtlMs = options.snapshotTtlMs ?? SNAPSHOT_TTL_MS;

        if (
            !Number.isSafeInteger(this.snapshotTtlMs) ||
            this.snapshotTtlMs < DAY_MS ||
            this.snapshotTtlMs > 30 * DAY_MS
        ) {
            throw new Error("Network snapshot TTL must be an integer from 1 to 30 days.");
        }
    }

    public async record(
        input: RecordNetworkFeatureInput,
    ): Promise<NetworkFeatureSnapshot> {
        validateInput(input);
        const keys = buildKeys(this.keyPrefix, input);
        const result = await this.redis.eval(
            RECORD_NETWORK_FEATURES_SCRIPT,
            keys.length,
            ...keys,
            input.occurredAtEpochMs,
            digest(input.eventId),
            this.snapshotTtlMs,
        );

        if (
            !Array.isArray(result) ||
            result.length !== 2 ||
            (Number(result[0]) !== 0 && Number(result[0]) !== 1) ||
            typeof result[1] !== "string"
        ) {
            throw new Error("Redis returned an invalid network-feature result.");
        }

        const rarity: unknown = JSON.parse(result[1]);
        if (!isFiniteRatio(rarity)) {
            throw new Error("Redis returned a non-finite network-feature value.");
        }

        return Object.freeze({
            replay: Number(result[0]) === 1,
            destinationPortRarity: rarity,
        });
    }
}

function buildKeys(prefix: string, input: RecordNetworkFeatureInput): string[] {
    const organization = digest(input.organizationId);
    const source = digest(input.sourceIdentity);
    return [
        `${prefix}:${organization}:event:${digest(input.eventId)}`,
        `${prefix}:${organization}:source:${source}:ports:all`,
        `${prefix}:${organization}:source:${source}:port:${input.destinationPort}`,
    ];
}

function validateInput(input: RecordNetworkFeatureInput): void {
    if (
        input.organizationId.trim().length === 0 ||
        input.eventId.trim().length === 0 ||
        input.sourceIdentity.trim().length === 0
    ) {
        throw new Error("Network-feature identities must not be blank.");
    }
    if (!Number.isSafeInteger(input.occurredAtEpochMs) || input.occurredAtEpochMs < 0) {
        throw new Error("Network-feature timestamp must be a non-negative epoch millisecond integer.");
    }
    if (!Number.isInteger(input.destinationPort) || input.destinationPort < 1 || input.destinationPort > 65_535) {
        throw new Error("Network destination port must be an integer from 1 through 65535.");
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function isFiniteRatio(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
