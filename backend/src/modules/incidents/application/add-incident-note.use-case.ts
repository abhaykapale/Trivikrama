import type {
  AddIncidentNoteCommand,
  AddIncidentNoteResult,
  IncidentNoteCommandUnitOfWork,
} from "../domain/incident-note-command.contracts.js";

export class AddIncidentNoteUseCase {
  public constructor(private readonly unitOfWork: IncidentNoteCommandUnitOfWork) {}

  public execute(
    command: AddIncidentNoteCommand,
  ): Promise<AddIncidentNoteResult | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const incident = await transaction.incidents.findByIdForUpdate(
        command.incidentId,
        command.orgId,
      );
      if (incident === null) return null;

      const note = await transaction.notes.create({
        incidentId: incident.id,
        authorId: command.actor.id,
        content: command.content,
      });

      await transaction.audit.create({
        action: "incident_note_added",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "incident",
        targetId: incident.id,
        targetName: incident.title,
        details: {
          noteId: note.id,
          content: note.content,
        },
        newState: {
          noteId: note.id,
          authorId: note.authorId,
        },
        orgId: command.orgId,
      });

      return {
        id: note.id,
        incidentId: note.incidentId,
        authorId: note.authorId,
        authorName: command.actor.username,
        content: note.content,
        createdAt: note.createdAt,
      };
    });
  }
}
