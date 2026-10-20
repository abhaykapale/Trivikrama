import type {
  GetIncidentQuery,
  IIncidentQueryRepository,
  IncidentQueryRecord,
} from "../domain/incident-query.contracts.js";

export class GetIncidentDetailUseCase {
  public constructor(
    private readonly incidentQueries: IIncidentQueryRepository,
  ) {}

  public execute(input: GetIncidentQuery): Promise<IncidentQueryRecord | null> {
    return this.incidentQueries.findById(input);
  }
}
