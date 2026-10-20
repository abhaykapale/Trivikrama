import type { INormalizedEventRepository } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type { IIncidentQueryRepository } from "../domain/incident-query.contracts.js";
import type {
  GetIncidentTimelineQuery,
  GetIncidentTimelineResult,
  IIncidentTimelineRepository,
  IncidentTimelineEntry,
  IncidentTimelineStoredEntry,
} from "../domain/incident-timeline.contracts.js";

export interface GetIncidentTimelineUseCaseDependencies {
  readonly incidentQueries: Pick<IIncidentQueryRepository, "findById">;
  readonly timeline: IIncidentTimelineRepository;
  readonly normalizedEvents: Pick<INormalizedEventRepository, "listByEventIds">;
}

export class GetIncidentTimelineUseCase {
  public constructor(
    private readonly dependencies: GetIncidentTimelineUseCaseDependencies,
  ) {}

  public async execute(
    input: GetIncidentTimelineQuery,
  ): Promise<GetIncidentTimelineResult | null> {
    const incident = await this.dependencies.incidentQueries.findById({
      incidentId: input.incidentId,
      orgId: input.orgId,
    });
    if (incident === null) return null;

    const page = await this.dependencies.timeline.list(input);
    const eventIds = page.items.flatMap((entry) =>
      entry.type === "event" ? [entry.eventId] : [],
    );
    const normalizedEvents =
      eventIds.length === 0
        ? []
        : await this.dependencies.normalizedEvents.listByEventIds(eventIds);
    const messagesByEventId = new Map(
      normalizedEvents.flatMap((event) =>
        event.org_id === input.orgId
          ? ([[event.event_id, event.message]] as const)
          : [],
      ),
    );
    const data = page.items.map((entry) =>
      enrichTimelineEntry(entry, input.incidentId, messagesByEventId),
    );
    const totalPages = Math.ceil(page.total / input.limit);

    return {
      data,
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

function enrichTimelineEntry(
  entry: IncidentTimelineStoredEntry,
  incidentId: string,
  messagesByEventId: ReadonlyMap<string, string>,
): IncidentTimelineEntry {
  if (entry.type !== "event") return { ...entry, incidentId };

  return {
    ...entry,
    incidentId,
    eventMessage: messagesByEventId.get(entry.eventId) ?? null,
  };
}
