import { createHash } from "node:crypto";

import type {
    AuthenticationFeatureSnapshot,
    IAuthenticationFeatureStore,
    RecordAuthenticationFeatureInput,
} from "../domain/authentication-feature-store.contracts.js";

interface RedisEvalClient {
    eval(
        script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown>;
}

const DAY_MS = 86_400_000;
const SNAPSHOT_TTL_MS = 7 * DAY_MS;

const RECORD_AUTHENTICATION_FEATURES_SCRIPT = `
local snapshot_key = KEYS[1]
local failed_events_key = KEYS[2]
local all_attempts_key = KEYS[3]
local successful_source_ips_key = KEYS[4]

local cached = redis.call('GET', snapshot_key)
if cached then
  return {1, cached}
end

local now_ms = tonumber(ARGV[1])
local event_member = ARGV[2]
local outcome = ARGV[3]
local has_source = ARGV[4] == '1'
local source_member = ARGV[5]
local snapshot_ttl_ms = tonumber(ARGV[6])

redis.call('ZADD', all_attempts_key, 'NX', now_ms, event_member)
redis.call('ZREMRANGEBYSCORE', all_attempts_key, '-inf', now_ms - 3600000)
local total_attempts = redis.call('ZCOUNT', all_attempts_key, now_ms - 3599999, now_ms)
redis.call('PEXPIRE', all_attempts_key, 3600000)

if outcome == 'failure' then
  redis.call('ZADD', failed_events_key, 'NX', now_ms, event_member)
end
redis.call('ZREMRANGEBYSCORE', failed_events_key, '-inf', now_ms - 3600000)
local failed_ten_minutes = redis.call(
  'ZCOUNT', failed_events_key, now_ms - 599999, now_ms
)
local failed_one_hour = redis.call(
  'ZCOUNT', failed_events_key, now_ms - 3599999, now_ms
)
redis.call('PEXPIRE', failed_events_key, 3600000)

local failure_ratio = 0
if total_attempts > 0 then
  failure_ratio = failed_one_hour / total_attempts
end

local new_source_ip = 0
if has_source then
  local known_occurrences = redis.call(
    'ZRANGEBYSCORE', successful_source_ips_key, now_ms - 604799999, now_ms
  )
  local source_known = false
  for _, occurrence in ipairs(known_occurrences) do
    if string.sub(occurrence, 1, 64) == source_member then
      source_known = true
      break
    end
  end
  if not source_known then
    new_source_ip = 1
  end

  if outcome == 'success' then
    redis.call(
      'ZADD', successful_source_ips_key, 'NX', now_ms,
      source_member .. ':' .. event_member
    )
  end
  redis.call(
    'ZREMRANGEBYSCORE', successful_source_ips_key, '-inf', now_ms - 604800000
  )
  redis.call('PEXPIRE', successful_source_ips_key, 604800000)
end

local encoded = cjson.encode({
  failed_ten_minutes,
  failure_ratio,
  new_source_ip
})
redis.call('PSETEX', snapshot_key, snapshot_ttl_ms, encoded)
return {0, encoded}
`;

export interface RedisAuthenticationFeatureStoreOptions {
    readonly keyPrefix?: string;
    readonly snapshotTtlMs?: number;
}

export class RedisAuthenticationFeatureStore
    implements IAuthenticationFeatureStore
{
    private readonly keyPrefix: string;
    private readonly snapshotTtlMs: number;

    public constructor(
        private readonly redis: RedisEvalClient,
        options: RedisAuthenticationFeatureStoreOptions = {},
    ) {
        this.keyPrefix = options.keyPrefix?.trim() || "features:authentication:v1";
        this.snapshotTtlMs = options.snapshotTtlMs ?? SNAPSHOT_TTL_MS;

        if (
            !Number.isSafeInteger(this.snapshotTtlMs) ||
            this.snapshotTtlMs < DAY_MS ||
            this.snapshotTtlMs > 30 * DAY_MS
        ) {
            throw new Error("Authentication snapshot TTL must be an integer from 1 to 30 days.");
        }
    }

    public async record(
        input: RecordAuthenticationFeatureInput,
    ): Promise<AuthenticationFeatureSnapshot> {
        validateInput(input);
        const keys = buildKeys(this.keyPrefix, input);
        const result = await this.redis.eval(
            RECORD_AUTHENTICATION_FEATURES_SCRIPT,
            keys.length,
            ...keys,
            input.occurredAtEpochMs,
            digest(input.eventId),
            input.outcome,
            input.sourceIp === undefined ? "0" : "1",
            digest(input.sourceIp ?? "missing-source"),
            this.snapshotTtlMs,
        );

        if (
            !Array.isArray(result) ||
            result.length !== 2 ||
            (Number(result[0]) !== 0 && Number(result[0]) !== 1) ||
            typeof result[1] !== "string"
        ) {
            throw new Error("Redis returned an invalid authentication-feature result.");
        }

        return decodeSnapshot(result[1], Number(result[0]) === 1);
    }
}

function buildKeys(
    prefix: string,
    input: RecordAuthenticationFeatureInput,
): string[] {
    const organization = digest(input.organizationId);
    const user = digest(input.username);

    return [
        `${prefix}:${organization}:event:${digest(input.eventId)}`,
        `${prefix}:${organization}:user-failures:${user}`,
        `${prefix}:${organization}:user-attempts:${user}`,
        `${prefix}:${organization}:user-success-sources:${user}`,
    ];
}

function decodeSnapshot(
    encoded: string,
    replay: boolean,
): AuthenticationFeatureSnapshot {
    let values: unknown;
    try {
        values = JSON.parse(encoded);
    } catch {
        throw new Error("Redis returned malformed authentication-feature JSON.");
    }

    if (!Array.isArray(values) || values.length !== 3) {
        throw new Error("Redis returned malformed authentication-feature values.");
    }

    const [failedCount, failureRatio, newSourceIp] = values;
    if (
        !isFiniteNonNegative(failedCount) ||
        !isFiniteRatio(failureRatio) ||
        (newSourceIp !== 0 && newSourceIp !== 1)
    ) {
        throw new Error("Redis returned non-finite authentication-feature values.");
    }

    return Object.freeze({
        replay,
        failedLoginCount10Minutes: failedCount,
        failedToSuccessRatio: failureRatio,
        newSourceIp,
    });
}

function validateInput(input: RecordAuthenticationFeatureInput): void {
    if (
        input.organizationId.trim().length === 0 ||
        input.eventId.trim().length === 0 ||
        input.username.trim().length === 0
    ) {
        throw new Error("Authentication-feature identities must not be blank.");
    }
    if (
        !Number.isSafeInteger(input.occurredAtEpochMs) ||
        input.occurredAtEpochMs < 0
    ) {
        throw new Error("Authentication-feature timestamp must be a non-negative epoch millisecond integer.");
    }
    if (input.outcome !== "success" && input.outcome !== "failure") {
        throw new Error("Authentication-feature outcome must be success or failure.");
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteRatio(value: unknown): value is number {
    return isFiniteNonNegative(value) && value <= 1;
}
