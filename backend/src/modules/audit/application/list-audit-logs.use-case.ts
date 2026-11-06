import {
  AUDIT_DEFAULT_WINDOW_MS,
  AUDIT_MAX_WINDOW_MS,
  InvalidAuditTimeRangeError,
  auditQuerySystemClock,
  type AuditQueryClock,
  type IAuditQueryRepository,
  type ListAuditLogsInput,
  type ListAuditLogsResult,
} from "../domain/audit-query.contracts.js";

export class ListAuditLogsUseCase {
  public constructor(
    private readonly auditLogs: IAuditQueryRepository,
    private readonly clock: AuditQueryClock = auditQuerySystemClock,
  ) {}

  public async execute(input: ListAuditLogsInput): Promise<ListAuditLogsResult> {
    const to = input.to ?? this.clock.now();
    const from = input.from ?? new Date(to.getTime() - AUDIT_DEFAULT_WINDOW_MS);
    const duration = to.getTime() - from.getTime();
    if (duration < 0) throw new InvalidAuditTimeRangeError("inverted");
    if (duration > AUDIT_MAX_WINDOW_MS) throw new InvalidAuditTimeRangeError("too_large");

    const page = await this.auditLogs.list({
      ...input,
      from,
      to,
      offset: (input.page - 1) * input.limit,
    });
    const totalPages = page.total === 0 ? 0 : Math.ceil(page.total / input.limit);
    return {
      data: page.items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: page.total,
        totalPages,
        hasNext: input.page < totalPages,
        hasPrev: input.page > 1,
      },
    };
  }
}
