import type { PostgresClient } from "../../../database/postgres/client.js";
import { ListAuditLogsUseCase } from "../application/list-audit-logs.use-case.js";
import { PostgresAuditQueryRepository } from "../infrastructure/postgres-audit-query.repository.js";

export interface AuditQueryDependencies {
  readonly listAuditLogsUseCase: ListAuditLogsUseCase;
}

export function createAuditQueryDependencies(postgres: PostgresClient): AuditQueryDependencies {
  return { listAuditLogsUseCase: new ListAuditLogsUseCase(new PostgresAuditQueryRepository(postgres)) };
}
