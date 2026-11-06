import { isDeepStrictEqual } from "node:util";
import { validateConfigurationValue } from "./configuration-value.policy.js";
import type { ConfigurationCommandUnitOfWork, UpdateConfigurationCommand, UpdateConfigurationResult } from "../domain/configuration.contracts.js";

export class UpdateConfigurationUseCase {
  public constructor(private readonly unitOfWork: ConfigurationCommandUnitOfWork) {}

  public async execute(input: UpdateConfigurationCommand): Promise<UpdateConfigurationResult | null> {
    const value = validateConfigurationValue(input.key, input.value);
    return this.unitOfWork.execute(async ({ configuration, audit }) => {
      const current = await configuration.findByKeyForUpdate(input.key);
      if (current === null || current.isSensitive) return null;
      if (isDeepStrictEqual(current.value, value)) return toResult(current, current.value, input.actor.id);

      const updated = await configuration.updateValue(input.key, { value, updatedBy: input.actor.id });
      if (updated === null) return null;
      await audit.create({
        action: "config_change",
        actorId: input.actor.id,
        actorUsername: input.actor.username,
        actorRole: input.actor.role,
        ipAddress: input.actor.ipAddress,
        targetType: "config",
        targetId: input.key,
        targetName: current.description ?? input.key,
        details: { key: input.key },
        previousState: { value: current.value },
        newState: { value: updated.value },
        orgId: input.actor.orgId,
      });
      return toResult(updated, current.value, input.actor.id);
    });
  }
}

function toResult(record: { readonly key: string; readonly value: unknown; readonly updatedAt: Date }, previousValue: unknown, actorId: string): UpdateConfigurationResult {
  return { key: record.key, value: record.value, previousValue, updatedAt: record.updatedAt, updatedBy: actorId };
}
