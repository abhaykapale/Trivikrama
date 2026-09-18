import { createHash } from "node:crypto";

import type {
  CountWindowSnapshot,
  ICountWindowStore,
  RecordCountWindowMatchInput,
} from "../domain/count-window-store.contracts.js";

interface RedisEvalClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...arguments_: readonly (string | number)[]
  ): Promise<unknown>;
}

const RECORD_MATCH_SCRIPT = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local cutoff_ms = tonumber(ARGV[2])
local ttl_ms = tonumber(ARGV[3])
local event_id = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff_ms)
local inserted = redis.call('ZADD', key, 'NX', now_ms, event_id)
redis.call('PEXPIRE', key, ttl_ms)
local event_ids = redis.call('ZRANGE', key, 0, -1)

table.insert(event_ids, 1, inserted)
return event_ids
`;

export interface RedisCountWindowStoreOptions {
  readonly keyPrefix?: string;
}

export class RedisCountWindowStore implements ICountWindowStore {
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: RedisEvalClient,
    options: RedisCountWindowStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix?.trim() || "rule:count:v1";
  }

  public async recordMatch(
    input: RecordCountWindowMatchInput,
  ): Promise<CountWindowSnapshot> {
    validateInput(input);
    const windowMilliseconds = input.windowSeconds * 1_000;
    const key = buildRedisKey(this.keyPrefix, input);
    const result = await this.redis.eval(
      RECORD_MATCH_SCRIPT,
      1,
      key,
      input.occurredAtEpochMs,
      input.occurredAtEpochMs - windowMilliseconds,
      windowMilliseconds,
      input.eventId,
    );

    if (!Array.isArray(result) || result.length === 0) {
      throw new Error("Redis returned an invalid count-window result.");
    }

    const insertedValue = Number(result[0]);
    const eventIds = result.slice(1);
    if (
      (insertedValue !== 0 && insertedValue !== 1) ||
      !eventIds.every((eventId) => typeof eventId === "string")
    ) {
      throw new Error("Redis returned malformed count-window values.");
    }

    return {
      inserted: insertedValue === 1,
      count: eventIds.length,
      eventIds: Object.freeze(eventIds as string[]),
    };
  }
}

function buildRedisKey(
  prefix: string,
  input: RecordCountWindowMatchInput,
): string {
  return [
    prefix,
    digest(input.organizationId),
    digest(input.ruleId),
    digest(input.ruleStateVersion),
    digest(input.entityKey),
  ].join(":");
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateInput(input: RecordCountWindowMatchInput): void {
  if (
    input.organizationId.trim().length === 0 ||
    input.ruleId.trim().length === 0 ||
    input.ruleStateVersion.trim().length === 0 ||
    input.entityKey.length === 0 ||
    input.eventId.trim().length === 0
  ) {
    throw new Error("Count-window identities must not be blank.");
  }
  if (
    !Number.isSafeInteger(input.occurredAtEpochMs) ||
    input.occurredAtEpochMs < 0
  ) {
    throw new Error("Count-window timestamp must be a non-negative epoch millisecond integer.");
  }
  if (
    !Number.isSafeInteger(input.windowSeconds) ||
    input.windowSeconds < 1 ||
    input.windowSeconds > 86_400
  ) {
    throw new Error("Count-window duration must be an integer between 1 and 86400 seconds.");
  }
}
