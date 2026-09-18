import { createHash } from "node:crypto";

import type {
    IFeatureHistoryStore,
    RecordFeatureHistoryInput,
    TemporalFrequencyFeatureSnapshot,
} from "../domain/feature-history-store.contracts.js";

interface RedisEvalClient {
    eval(
        script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown>;
}

const DAY_MS = 86_400_000;
const SNAPSHOT_TTL_MS = 7 * DAY_MS;

const RECORD_FEATURES_SCRIPT = `
local snapshot_key = KEYS[1]
local source_events_key = KEYS[2]
local user_events_key = KEYS[3]
local destination_ips_key = KEYS[4]
local source_users_key = KEYS[5]
local source_time_stats_key = KEYS[6]

local cached = redis.call('GET', snapshot_key)
if cached then
  return {1, cached}
end

local now_ms = tonumber(ARGV[1])
local event_member = ARGV[2]
local has_source = ARGV[3] == '1'
local has_user = ARGV[4] == '1'
local has_destination = ARGV[5] == '1'
local destination_member = ARGV[6]
local user_member = ARGV[7]
local snapshot_ttl_ms = tonumber(ARGV[8])

local time_since = cjson.null
local time_deviation = 0
local events_per_minute = 0
local events_per_hour = 0
local unique_destinations = 1
local unique_users = 1
local frequency_deviation = 0

if has_source then
  local previous = redis.call(
    'ZREVRANGEBYSCORE', source_events_key, now_ms, '-inf', 'WITHSCORES', 'LIMIT', 0, 1
  )
  if #previous >= 2 then
    time_since = math.max(0, (now_ms - tonumber(previous[2])) / 1000)
  end

  local day_cutoff = now_ms - 86400000
  local previous_day_count = redis.call('ZCOUNT', source_events_key, day_cutoff, now_ms)
  redis.call('ZADD', source_events_key, 'NX', now_ms, event_member)
  redis.call('ZREMRANGEBYSCORE', source_events_key, '-inf', day_cutoff)
  events_per_minute = redis.call('ZCOUNT', source_events_key, now_ms - 59999, now_ms)

  if previous_day_count > 0 then
    local expected_per_minute = previous_day_count / 1440
    frequency_deviation =
      (events_per_minute - expected_per_minute) / math.sqrt(math.max(expected_per_minute, 1))
  end
  redis.call('PEXPIRE', source_events_key, 86400000)

  local seconds_of_day = math.floor(now_ms / 1000) % 86400
  local stats = redis.call('HMGET', source_time_stats_key, 'count', 'sum', 'sum_squares')
  local count = tonumber(stats[1]) or 0
  local sum = tonumber(stats[2]) or 0
  local sum_squares = tonumber(stats[3]) or 0
  if count >= 2 then
    local mean = sum / count
    local variance = math.max(0, (sum_squares / count) - (mean * mean))
    if variance > 0 then
      time_deviation = (seconds_of_day - mean) / math.sqrt(variance)
    end
  end
  redis.call(
    'HSET', source_time_stats_key,
    'count', count + 1,
    'sum', sum + seconds_of_day,
    'sum_squares', sum_squares + (seconds_of_day * seconds_of_day)
  )
  redis.call('PEXPIRE', source_time_stats_key, 86400000)

  if has_destination then
    redis.call('ZADD', destination_ips_key, 'NX', now_ms, destination_member .. ':' .. event_member)
    redis.call('ZREMRANGEBYSCORE', destination_ips_key, '-inf', now_ms - 600000)
    local destination_occurrences = redis.call(
      'ZRANGEBYSCORE', destination_ips_key, now_ms - 599999, now_ms
    )
    local destinations_seen = {}
    unique_destinations = 0
    for _, occurrence in ipairs(destination_occurrences) do
      local identity = string.sub(occurrence, 1, 64)
      if not destinations_seen[identity] then
        destinations_seen[identity] = true
        unique_destinations = unique_destinations + 1
      end
    end
    redis.call('PEXPIRE', destination_ips_key, 600000)
  end

  if has_user then
    redis.call('ZADD', source_users_key, 'NX', now_ms, user_member .. ':' .. event_member)
    redis.call('ZREMRANGEBYSCORE', source_users_key, '-inf', now_ms - 600000)
    local user_occurrences = redis.call(
      'ZRANGEBYSCORE', source_users_key, now_ms - 599999, now_ms
    )
    local users_seen = {}
    unique_users = 0
    for _, occurrence in ipairs(user_occurrences) do
      local identity = string.sub(occurrence, 1, 64)
      if not users_seen[identity] then
        users_seen[identity] = true
        unique_users = unique_users + 1
      end
    end
    redis.call('PEXPIRE', source_users_key, 600000)
  end
end

if has_user then
  redis.call('ZADD', user_events_key, 'NX', now_ms, event_member)
  redis.call('ZREMRANGEBYSCORE', user_events_key, '-inf', now_ms - 3600000)
  events_per_hour = redis.call('ZCOUNT', user_events_key, now_ms - 3599999, now_ms)
  redis.call('PEXPIRE', user_events_key, 3600000)
end

local encoded = cjson.encode({
  time_since,
  time_deviation,
  events_per_minute,
  events_per_hour,
  unique_destinations,
  unique_users,
  frequency_deviation
})
redis.call('PSETEX', snapshot_key, snapshot_ttl_ms, encoded)
return {0, encoded}
`;

export interface RedisTemporalFrequencyFeatureStoreOptions {
    readonly keyPrefix?: string;
    readonly snapshotTtlMs?: number;
}

export class RedisTemporalFrequencyFeatureStore
    implements IFeatureHistoryStore
{
    private readonly keyPrefix: string;
    private readonly snapshotTtlMs: number;

    public constructor(
        private readonly redis: RedisEvalClient,
        options: RedisTemporalFrequencyFeatureStoreOptions = {},
    ) {
        this.keyPrefix = options.keyPrefix?.trim() || "features:history:v1";
        this.snapshotTtlMs = options.snapshotTtlMs ?? SNAPSHOT_TTL_MS;

        if (
            !Number.isSafeInteger(this.snapshotTtlMs) ||
            this.snapshotTtlMs < DAY_MS ||
            this.snapshotTtlMs > 30 * DAY_MS
        ) {
            throw new Error("Feature snapshot TTL must be an integer from 1 to 30 days.");
        }
    }

    public async record(
        input: RecordFeatureHistoryInput,
    ): Promise<TemporalFrequencyFeatureSnapshot> {
        validateInput(input);
        const keys = buildKeys(this.keyPrefix, input);
        const result = await this.redis.eval(
            RECORD_FEATURES_SCRIPT,
            keys.length,
            ...keys,
            input.occurredAtEpochMs,
            digest(input.eventId),
            input.sourceIp === undefined ? "0" : "1",
            input.username === undefined ? "0" : "1",
            input.destinationIp === undefined ? "0" : "1",
            digest(input.destinationIp ?? "missing-destination"),
            digest(input.username ?? "missing-user"),
            this.snapshotTtlMs,
        );

        if (
            !Array.isArray(result) ||
            result.length !== 2 ||
            (Number(result[0]) !== 0 && Number(result[0]) !== 1) ||
            typeof result[1] !== "string"
        ) {
            throw new Error("Redis returned an invalid feature-history result.");
        }

        return decodeSnapshot(result[1], Number(result[0]) === 1);
    }
}

function buildKeys(
    prefix: string,
    input: RecordFeatureHistoryInput,
): string[] {
    const organization = digest(input.organizationId);
    const source = digest(input.sourceIp ?? "missing-source");
    const user = digest(input.username ?? "missing-user");

    return [
        `${prefix}:${organization}:event:${digest(input.eventId)}`,
        `${prefix}:${organization}:source-events:${source}`,
        `${prefix}:${organization}:user-events:${user}`,
        `${prefix}:${organization}:destination-ips:${source}`,
        `${prefix}:${organization}:source-users:${source}`,
        `${prefix}:${organization}:source-time:${source}`,
    ];
}

function decodeSnapshot(
    encoded: string,
    replay: boolean,
): TemporalFrequencyFeatureSnapshot {
    let values: unknown;
    try {
        values = JSON.parse(encoded);
    } catch {
        throw new Error("Redis returned malformed feature-history JSON.");
    }

    if (!Array.isArray(values) || values.length !== 7) {
        throw new Error("Redis returned malformed feature-history values.");
    }

    const [timeSince, timeDeviation, perMinute, perHour, destinations, users, deviation] =
        values;
    if (
        !isNullableFiniteNonNegative(timeSince) ||
        !isFiniteNumber(timeDeviation) ||
        !isFiniteNonNegative(perMinute) ||
        !isFiniteNonNegative(perHour) ||
        !isFiniteNonNegative(destinations) ||
        !isFiniteNonNegative(users) ||
        !isFiniteNumber(deviation)
    ) {
        throw new Error("Redis returned non-finite feature-history values.");
    }

    return Object.freeze({
        replay,
        timeSinceLastEventSeconds: timeSince,
        timeDeviationScore: timeDeviation,
        eventsPerMinuteSourceIp: perMinute,
        eventsPerHourUser: perHour,
        uniqueDestinationIpsPerSource: destinations,
        uniqueUsersPerSourceIp: users,
        frequencyDeviation: deviation,
    });
}

function validateInput(input: RecordFeatureHistoryInput): void {
    if (
        input.organizationId.trim().length === 0 ||
        input.eventId.trim().length === 0
    ) {
        throw new Error("Feature-history identities must not be blank.");
    }
    if (
        !Number.isSafeInteger(input.occurredAtEpochMs) ||
        input.occurredAtEpochMs < 0
    ) {
        throw new Error("Feature-history timestamp must be a non-negative epoch millisecond integer.");
    }
}

function digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isNullableFiniteNonNegative(value: unknown): value is number | null {
    return value === null || isFiniteNonNegative(value);
}
