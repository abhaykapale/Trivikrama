import type { IConfigurationRepository } from "../../../database/repositories/configuration/configuration.repository.js";
import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { UserRole } from "../../../database/repositories/users/user.repository.js";

export const AI_ANOMALY_THRESHOLD_KEY = "ai.anomaly_threshold" as const;

export interface ConfigurationView {
  readonly key: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly isSensitive: false;
  readonly updatedAt: Date;
}

export interface ListConfigurationResult { readonly data: readonly ConfigurationView[]; }

export interface ConfigurationActor {
  readonly id: string;
  readonly username: string;
  readonly role: UserRole;
  readonly ipAddress: string | null;
  readonly orgId: string;
}

export interface UpdateConfigurationCommand {
  readonly key: string;
  readonly value: unknown;
  readonly actor: ConfigurationActor;
}

export interface UpdateConfigurationResult {
  readonly key: string;
  readonly value: unknown;
  readonly previousValue: unknown;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

export type ConfigurationQueryRepository = Pick<IConfigurationRepository, "list">;

export interface ConfigurationCommandTransaction {
  readonly configuration: Pick<IConfigurationRepository, "findByKeyForUpdate" | "updateValue">;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface ConfigurationCommandUnitOfWork {
  execute<TResult>(operation: (transaction: ConfigurationCommandTransaction) => Promise<TResult>): Promise<TResult>;
}

export class InvalidConfigurationValueError extends Error {
  public readonly code = "INVALID_CONFIGURATION_VALUE" as const;
  public constructor(public readonly key: string, public readonly issues: readonly string[]) {
    super(`The supplied value is invalid for configuration key ${key}.`);
    this.name = "InvalidConfigurationValueError";
  }
}

export class ConfigurationKeyNotManagedError extends Error {
  public readonly code = "CONFIGURATION_KEY_NOT_MANAGED" as const;
  public constructor(public readonly key: string) {
    super(`Configuration key ${key} is not managed through this API.`);
    this.name = "ConfigurationKeyNotManagedError";
  }
}
