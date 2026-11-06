import type { MongoDbClient } from "../../../database/mongodb/client.js";
import { ExportEventsUseCase } from "../application/export-events.use-case.js";
import { GetEventDetailUseCase } from "../application/get-event-detail.use-case.js";
import { SearchEventsUseCase } from "../application/search-events.use-case.js";
import { MongoEventInvestigationRepository } from "../infrastructure/mongo-event-investigation.repository.js";

export interface EventQueryDependencies {
  readonly searchEventsUseCase: SearchEventsUseCase;
  readonly getEventDetailUseCase: GetEventDetailUseCase;
  readonly exportEventsUseCase: ExportEventsUseCase;
}

export function createEventQueryDependencies(
  mongodb: MongoDbClient,
): EventQueryDependencies {
  const repository = new MongoEventInvestigationRepository(mongodb);
  return {
    searchEventsUseCase: new SearchEventsUseCase(repository),
    getEventDetailUseCase: new GetEventDetailUseCase(repository),
    exportEventsUseCase: new ExportEventsUseCase(repository),
  };
}
