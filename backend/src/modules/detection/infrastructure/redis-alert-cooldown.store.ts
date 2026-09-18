import { createHash } from "node:crypto";

import type {
  AcquireAlertCooldownInput,
  IAlertCooldownStore,
} from "../domain/alert-cooldown-store.contracts.js";

interface RedisEvalClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...arguments_: readonly (string | number)[]
  ): Promise<unknown>;
}

const ACQUIRE_COOLDOWN_SCRIPT = `
local current_owner = redis.call('GET', KEYS[1])
if not current_owner then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if current_owner == ARGV[1] then
  return 1
end
return 0
`;

export interface RedisAlertCooldownStoreOptions {
  readonly keyPrefix?: string;
}

export class RedisAlertCooldownStore implements IAlertCooldownStore {
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: RedisEvalClient,
    options: RedisAlertCooldownStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix?.trim() || "rule:cooldown:v1";
  }

  public async tryAcquire(input: AcquireAlertCooldownInput): Promise<boolean> {
    validateInput(input);
    const result = await this.redis.eval(
      ACQUIRE_COOLDOWN_SCRIPT,
      1,
      buildRedisKey(this.keyPrefix, input),
      input.alertId,
      input.cooldownSeconds * 1_000,
    );

    if (Number(result) === 1) return true;
    if (Number(result) === 0) return false;
    throw new Error("Redis returned an invalid alert-cooldown result.");
  }
}

function buildRedisKey(
  prefix: string,
  input: AcquireAlertCooldownInput,
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

function validateInput(input: AcquireAlertCooldownInput): void {
  if (
    input.organizationId.trim().length === 0 ||
    input.ruleId.trim().length === 0 ||
    input.ruleStateVersion.trim().length === 0 ||
    input.entityKey.length === 0 ||
    input.alertId.trim().length === 0
  ) {
    throw new Error("Alert-cooldown identities must not be blank.");
  }
  if (
    !Number.isSafeInteger(input.cooldownSeconds) ||
    input.cooldownSeconds < 1 ||
    input.cooldownSeconds > 86_400
  ) {
    throw new Error("Alert cooldown must be an integer between 1 and 86400 seconds.");
  }
}
