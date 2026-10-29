import type { RepositoryClock } from "../../../database/repositories/common/index.js";
import { systemClock } from "../../../database/repositories/common/index.js";
import type {
  GetIncidentContextQuery,
  GetIncidentContextResult,
  IIncidentContextRepository,
} from "../domain/incident-context.contracts.js";
import type { IIncidentQueryRepository } from "../domain/incident-query.contracts.js";
import type { IncidentEntity } from "../domain/incident.contracts.js";

const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONTEXT_ENTITIES = 100;
const PREVIOUS_INCIDENT_LIMIT = 50;

export class GetIncidentContextUseCase {
  public constructor(
    private readonly incidentQueries: Pick<IIncidentQueryRepository, "findById">,
    private readonly contextQueries: IIncidentContextRepository,
    private readonly clock: RepositoryClock = systemClock,
  ) {}

  public async execute(
    input: GetIncidentContextQuery,
  ): Promise<GetIncidentContextResult | null> {
    const incident = await this.incidentQueries.findById(input);
    if (incident === null) return null;

    const entities = uniqueEntities(incident.entities).slice(
      0,
      MAX_CONTEXT_ENTITIES,
    );
    if (entities.length === 0) {
      return { previousIncidents: [], assets: [], entityHistory: {} };
    }

    return this.contextQueries.getContext({
      ...input,
      entities,
      historySince: new Date(this.clock.now().getTime() - HISTORY_WINDOW_MS),
      previousIncidentLimit: PREVIOUS_INCIDENT_LIMIT,
    });
  }
}

function uniqueEntities(
  entities: readonly IncidentEntity[],
): readonly IncidentEntity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.type}\u0000${entity.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
