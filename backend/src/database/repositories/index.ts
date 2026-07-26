import type { PostgresClient } from "../postgres/index.js";
import { PostgresAuditRepository } from "./audit/index.js";
import { PostgresConfigurationRepository } from "./configuration/index.js";
import { PostgresRuleRepository } from "./rules/index.js";
import { PostgresUserRepository } from "./users/index.js";

export * from "./common/index.js";
export * from "./users/index.js";
export * from "./audit/index.js";
export * from "./configuration/index.js";
export * from "./rules/index.js";

export interface PostgresRepositories {
  readonly users: PostgresUserRepository;
  readonly audit: PostgresAuditRepository;
  readonly configuration: PostgresConfigurationRepository;
  readonly rules: PostgresRuleRepository;
}

export function createPostgresRepositories(client: PostgresClient): PostgresRepositories {
  return {
    users: new PostgresUserRepository(client),
    audit: new PostgresAuditRepository(client),
    configuration: new PostgresConfigurationRepository(client),
    rules: new PostgresRuleRepository(client),
  };
}
