import type {
  EventDetailView,
  GetEventDetailInput,
  IEventInvestigationRepository,
} from "../domain/event-query.contracts.js";

export class GetEventDetailUseCase {
  public constructor(
    private readonly repository: Pick<IEventInvestigationRepository, "findById">,
  ) {}

  public async execute(
    input: GetEventDetailInput,
  ): Promise<EventDetailView | null> {
    return this.repository.findById(input);
  }
}
