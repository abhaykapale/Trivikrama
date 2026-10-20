import type {
  IIncidentQueryRepository,
  ListIncidentsQuery,
  ListIncidentsResult,
} from "../domain/incident-query.contracts.js";

export class ListIncidentsUseCase {
  public constructor(
    private readonly incidentQueries: IIncidentQueryRepository,
  ) {}

  public async execute(input: ListIncidentsQuery): Promise<ListIncidentsResult> {
    const result = await this.incidentQueries.list(input);
    const totalPages = Math.ceil(result.total / input.limit);

    return {
      data: result.items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: result.total,
        totalPages,
        hasNext: input.page < totalPages,
        hasPrev: input.page > 1,
      },
    };
  }
}
