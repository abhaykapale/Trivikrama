import {
  eventQuerySystemClock,
  type EventQueryClock,
  type EventSearchInput,
  type IEventInvestigationRepository,
  type SearchEventsResult,
} from "../domain/event-query.contracts.js";
import { toRepositorySearchQuery } from "./event-query.helpers.js";

export class SearchEventsUseCase {
  public constructor(
    private readonly repository: Pick<IEventInvestigationRepository, "search">,
    private readonly clock: EventQueryClock = eventQuerySystemClock,
  ) {}

  public async execute(input: EventSearchInput): Promise<SearchEventsResult> {
    const query = toRepositorySearchQuery(input, this.clock);
    const result = await this.repository.search(query);
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / input.limit);

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
      window: { from: query.from, to: query.to },
    };
  }
}
