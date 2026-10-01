import { createHash } from "node:crypto";

import type {
    IProcessFeatureStore,
    ProcessFeatureSnapshot,
    RecordProcessFeatureInput,
} from "../domain/process-feature-store.contracts.js";

interface RedisEvalClient {
    eval(
        script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown>;
}

const DAY_MS = 86_400_000;
const SNAPSHOT_TTL_MS = 7 * DAY_MS;

const RECORD_PROCESS_FEATURES_SCRIPT = `
local snapshot_key = KEYS[1]
local all_processes_key = KEYS[2]
local named_process_key = KEYS[3]
local parent_child_key = KEYS[4]

local cached = redis.call('GET', snapshot_key)
if cached then
  return {1, cached}
end

local now_ms = tonumber(ARGV[1])
local event_member = ARGV[2]
local has_parent = ARGV[3] == '1'
local snapshot_ttl_ms = tonumber(ARGV[4])
local cutoff_ms = now_ms - 86400000

redis.call('ZREMRANGEBYSCORE', all_processes_key, '-inf', cutoff_ms)
redis.call('ZREMRANGEBYSCORE', named_process_key, '-inf', cutoff_ms)

local total_before = redis.call('ZCOUNT', all_processes_key, cutoff_ms + 1, now_ms)
local named_before = redis.call('ZCOUNT', named_process_key, cutoff_ms + 1, now_ms)
local rarity = 1
if total_before > 0 then
  rarity = 1 - (named_before / total_before)
end

local parent_child_anomaly = 0
if has_parent then
  redis.call('ZREMRANGEBYSCORE', parent_child_key, '-inf', cutoff_ms)
  local pair_before = redis.call('ZCOUNT', parent_child_key, cutoff_ms + 1, now_ms)
  if pair_before == 0 then
    parent_child_anomaly = 1
  end
end

redis.call('ZADD', all_processes_key, 'NX', now_ms, event_member)
redis.call('ZADD', named_process_key, 'NX', now_ms, event_member)
redis.call('PEXPIRE', all_processes_key, 86400000)
redis.call('PEXPIRE', named_process_key, 86400000)

if has_parent then
  redis.call('ZADD', parent_child_key, 'NX', now_ms, event_member)
  redis.call('PEXPIRE', parent_child_key, 86400000)
end

local encoded = cjson.encode({rarity, parent_child_anomaly})
redis.call('PSETEX', snapshot_key, snapshot_ttl_ms, encoded)
return {0, encoded}
`;

export interface RedisProcessFeatureStoreOptions {
    readonly keyPrefix?: string;
    readonly snapshotTtlMs?: number;
}

export class RedisProcessFeatureStore implements IProcessFeatureStore {
    private readonly keyPrefix: string;
    private readonly snapshotTtlMs: number;

    public constructor(
        private readonly redis: RedisEvalClient,
        options: RedisProcessFeatureStoreOptions = {},
    ) {
        this.keyPrefix = options.keyPrefix?.trim() || "features:process:v1";
        this.snapshotTtlMs = options.snapshotTtlMs ?? SNAPSHOT_TTL_MS;

        if (
            !Number.isSafeInteger(this.snapshotTtlMs) ||
            this.snapshotTtlMs < DAY_MS ||
            this.snapshotTtlMs > 30 * DAY_MS
        ) {
            throw new Error("Process snapshot TTL must be an integer from 1 to 30 days.");
        }
    }

    public async record(
        input: RecordProcessFeatureInput,
    ): Promise<ProcessFeatureSnapshot> {
        validateInput(input);
        const keys = buildKeys(this.keyPrefix, input);
        const result = await this.redis.eval(
            RECORD_PROCESS_FEATURES_SCRIPT,
            keys.length,
            ...keys,
            input.occurredAtEpochMs,
            digest(input.eventId),
            input.parentProcessName === undefined ? "0" : "1",
            this.snapshotTtlMs,
        );

        if (
            !Array.isArray(result) ||
            result.length !== 2 ||
            (Number(result[0]) !== 0 && Number(result[0]) !== 1) ||
            typeof result[1] !== "string"
        ) {
            throw new Error("Redis returned an invalid process-feature result.");
        }

        return decodeSnapshot(result[1], Number(result[0]) === 1);
    }
}

function buildKeys(prefix: string, input: RecordProcessFeatureInput): string[] {
    const organization = digest(input.organizationId);
    const endpoint = digest(input.endpointIdentity);
    const process = digest(input.processName);
    const pair = digest(`${input.parentProcessName ?? "missing-parent"}\u0000${input.processName}`);

    return [
        `${prefix}:${organization}:event:${digest(input.eventId)}`,
        `${prefix}:${organization}:endpoint:${endpoint}:all`,
        `${prefix}:${organization}:endpoint:${endpoint}:process:${process}`,
        `${prefix}:${organization}:endpoint:${endpoint}:pair:${pair}`,
    ];
}

function decodeSnapshot(encoded: string, replay: boolean): ProcessFeatureSnapshot {
    let values: unknown;
    try {
        values = JSON.parse(encoded);
    } catch {
        throw new Error("Redis returned malformed process-feature JSON.");
    }

    if (!Array.isArray(values) || values.length !== 2) {
        throw new Error("Redis returned malformed process-feature values.");
    }

    const [rarity, parentChildAnomaly] = values;
    if (
        !isFiniteRatio(rarity) ||
        (parentChildAnomaly !== 0 && parentChildAnomaly !== 1)
    ) {
        throw new Error("Redis returned non-finite process-feature values.");
    }

    return Object.freeze({
        replay,
        processRarityScore: rarity,
        parentChildAnomaly,
    });
}

function validateInput(input: RecordProcessFeatureInput): void {
    if (
        input.organizationId.trim().length === 0 ||
        input.eventId.trim().length === 0 ||
        input.endpointIdentity.trim().length === 0 ||
        input.processName.trim().length === 0
    ) {
        throw new Error("Process-feature identities must not be blank.");
    }
    if (
        !Number.isSafeInteger(input.occurredAtEpochMs) ||
        input.occurredAtEpochMs < 0
    ) {
        throw new Error("Process-feature timestamp must be a non-negative epoch millisecond integer.");
    }
    if (input.parentProcessName !== undefined && input.parentProcessName.trim().length === 0) {
        throw new Error("Process parent name must not be blank when provided.");
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function isFiniteRatio(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
