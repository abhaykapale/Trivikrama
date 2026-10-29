import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import { AssignIncidentUseCase } from "../application/assign-incident.use-case.js";
import { AddIncidentNoteUseCase } from "../application/add-incident-note.use-case.js";
import { ResolveIncidentUseCase } from "../application/resolve-incident.use-case.js";
import { TransitionIncidentStatusUseCase } from "../application/transition-incident-status.use-case.js";
import { PostgresIncidentAssignmentUnitOfWork } from "../infrastructure/postgres-incident-assignment-unit-of-work.js";
import { PostgresIncidentNoteCommandUnitOfWork } from "../infrastructure/postgres-incident-note-command-unit-of-work.js";
import { PostgresIncidentResolutionUnitOfWork } from "../infrastructure/postgres-incident-resolution-unit-of-work.js";
import { PostgresIncidentStatusUnitOfWork } from "../infrastructure/postgres-incident-status-unit-of-work.js";

export interface IncidentCommandDependencies {
  readonly transitionIncidentStatusUseCase: TransitionIncidentStatusUseCase;
  readonly assignIncidentUseCase: AssignIncidentUseCase;
  readonly addIncidentNoteUseCase: AddIncidentNoteUseCase;
  readonly resolveIncidentUseCase: ResolveIncidentUseCase;
}

export function createIncidentCommandDependencies(
  unitOfWork: IUnitOfWork,
): IncidentCommandDependencies {
  return {
    transitionIncidentStatusUseCase: new TransitionIncidentStatusUseCase(
      new PostgresIncidentStatusUnitOfWork(unitOfWork),
    ),
    assignIncidentUseCase: new AssignIncidentUseCase(
      new PostgresIncidentAssignmentUnitOfWork(unitOfWork),
    ),
    addIncidentNoteUseCase: new AddIncidentNoteUseCase(
      new PostgresIncidentNoteCommandUnitOfWork(unitOfWork),
    ),
    resolveIncidentUseCase: new ResolveIncidentUseCase(
      new PostgresIncidentResolutionUnitOfWork(unitOfWork),
    ),
  };
}
