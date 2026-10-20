import type { IIncidentQueryRepository } from "../domain/incident-query.contracts.js";
import type {
  IIncidentEvidenceQueryRepository,
  ListIncidentAlertsQuery,
  ListIncidentAlertsResult,
} from "../domain/incident-evidence.contracts.js";

export class ListIncidentAlertsUseCase {
  public constructor(
    private readonly incidentQueries: Pick<IIncidentQueryRepository, "findById">,
    private readonly evidenceQueries: Pick<
      IIncidentEvidenceQueryRepository,
      "listAlerts"
    >,
  ) {}

  public async execute(
    input: ListIncidentAlertsQuery,
  ): Promise<ListIncidentAlertsResult | null> {
    const incident = await this.incidentQueries.findById(input);
    if (incident === null) return null;

    const page = await this.evidenceQueries.listAlerts(input);
    return {
      data: page.items,
      pagination: pagination(input.page, input.limit, page.total),
    };
  }
}

export function pagination(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
