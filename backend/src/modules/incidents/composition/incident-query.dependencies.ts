import type { QueryExecutor } from "../../../database/repositories/common/index.js";
import type { INormalizedEventRepository } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import { GetIncidentDetailUseCase } from "../application/get-incident-detail.use-case.js";
import { GetIncidentTimelineUseCase } from "../application/get-incident-timeline.use-case.js";
import { GetIncidentContextUseCase } from "../application/get-incident-context.use-case.js";
import { ListIncidentsUseCase } from "../application/list-incidents.use-case.js";
import { ListIncidentAlertsUseCase } from "../application/list-incident-alerts.use-case.js";
import { ListIncidentEventsUseCase } from "../application/list-incident-events.use-case.js";
import { PostgresIncidentEvidenceQueryRepository } from "../infrastructure/postgres-incident-evidence-query.repository.js";
import { PostgresIncidentContextRepository } from "../infrastructure/postgres-incident-context.repository.js";
import { PostgresIncidentQueryRepository } from "../infrastructure/postgres-incident-query.repository.js";
import { PostgresIncidentTimelineRepository } from "../infrastructure/postgres-incident-timeline.repository.js";

export interface IncidentQueryDependencies {
  readonly listIncidentsUseCase: ListIncidentsUseCase;
  readonly getIncidentDetailUseCase: GetIncidentDetailUseCase;
  readonly getIncidentContextUseCase: GetIncidentContextUseCase;
  readonly getIncidentTimelineUseCase?: GetIncidentTimelineUseCase;
  readonly listIncidentAlertsUseCase?: ListIncidentAlertsUseCase;
  readonly listIncidentEventsUseCase?: ListIncidentEventsUseCase;
}

export function createIncidentQueryDependencies(
  postgres: QueryExecutor,
  normalizedEvents?: Pick<INormalizedEventRepository, "listByEventIds">,
): IncidentQueryDependencies {
  const incidentQueries = new PostgresIncidentQueryRepository(postgres);
  const evidenceQueries = new PostgresIncidentEvidenceQueryRepository(postgres);

  return {
    listIncidentsUseCase: new ListIncidentsUseCase(incidentQueries),
    getIncidentDetailUseCase: new GetIncidentDetailUseCase(incidentQueries),
    getIncidentContextUseCase: new GetIncidentContextUseCase(
      incidentQueries,
      new PostgresIncidentContextRepository(postgres),
    ),
    ...(normalizedEvents === undefined
      ? {}
      : {
          getIncidentTimelineUseCase: new GetIncidentTimelineUseCase({
            incidentQueries,
            timeline: new PostgresIncidentTimelineRepository(postgres),
            normalizedEvents,
          }),
          listIncidentAlertsUseCase: new ListIncidentAlertsUseCase(
            incidentQueries,
            evidenceQueries,
          ),
          listIncidentEventsUseCase: new ListIncidentEventsUseCase(
            incidentQueries,
            evidenceQueries,
            normalizedEvents,
          ),
        }),
  };
}
