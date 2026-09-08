import type {
    CreateNormalizedEventInput,
    INormalizedEventRepository,
} from "../../../database/repositories/mongodb/normalized-event.repository.js";

export type PersistNormalizedCollectorEventsResult =
    | {
          readonly status: "persisted";
          readonly insertedCount: number;
          readonly alreadyPresentCount: number;
      }
    | {
          readonly status: "event_id_collision";
          readonly eventId: string;
      };

export interface PersistNormalizedCollectorEventsDependencies {
    readonly normalizedEvents: Pick<INormalizedEventRepository, "createManyIfAbsent">;
}

/**
 * Enforces event-level idempotency at the unique event_id boundary. A replay is
 * accepted only when the existing event has the same content-derived hash.
 */
export class PersistNormalizedCollectorEventsService {
    public constructor(
        private readonly dependencies: PersistNormalizedCollectorEventsDependencies,
    ) {}

    public async execute(
        events: readonly CreateNormalizedEventInput[],
    ): Promise<PersistNormalizedCollectorEventsResult> {
        const result = await this.dependencies.normalizedEvents.createManyIfAbsent(events);
        const candidatesById = new Map(events.map((event) => [event.event_id, event]));

        for (const document of result.documents) {
            const candidate = candidatesById.get(document.event_id);

            if (
                candidate === undefined ||
                document.dedup_hash !== candidate.dedup_hash ||
                !sameRawEvent(document.raw_event, candidate.raw_event)
            ) {
                return {
                    status: "event_id_collision",
                    eventId: document.event_id,
                };
            }
        }

        return {
            status: "persisted",
            insertedCount: result.insertedCount,
            alreadyPresentCount: result.existingCount,
        };
    }
}

function sameRawEvent(
    existing: Record<string, unknown> | undefined,
    candidate: Record<string, unknown> | undefined,
): boolean {
    if (existing === undefined || candidate === undefined) {
        return false;
    }

    return JSON.stringify(existing) === JSON.stringify(candidate);
}
