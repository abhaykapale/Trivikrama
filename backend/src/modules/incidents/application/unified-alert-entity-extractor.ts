import {
  normalizeIncidentEntities,
} from "../domain/incident-entity.js";
import type {
  IncidentEntity,
} from "../domain/incident.contracts.js";
import type {
  AlertEntityEventSource,
  EnrichUnifiedAlertsWithEntitiesInput,
  EnrichUnifiedAlertsWithEntitiesResult,
  UnifiedAlert,
} from "../domain/unified-alert.contracts.js";

export class UnifiedAlertEntityExtractor {
  public enrich(
    input: EnrichUnifiedAlertsWithEntitiesInput,
  ): EnrichUnifiedAlertsWithEntitiesResult {
    const orgId = requireOrgId(input.orgId);
    const eventsById = indexEvents(orgId, input.events);
    const missingEventIds = new Set<string>();
    const resolvedEventIds = new Set<string>();

    const alerts = input.alerts.map((alert) => {
      if (alert.orgId !== orgId) {
        throw new Error(
          `Unified alert ${alert.id} crossed the incident organization boundary.`,
        );
      }

      const entities: IncidentEntity[] = [...alert.entities];
      for (const eventId of alert.matchedEventIds) {
        const event = eventsById.get(eventId);
        if (event === undefined) {
          missingEventIds.add(eventId);
          continue;
        }
        resolvedEventIds.add(eventId);
        entities.push(...extractEventEntities(event));
      }

      return Object.freeze({
        ...alert,
        entities: normalizeIncidentEntities(entities),
      }) as UnifiedAlert;
    });

    return Object.freeze({
      alerts: Object.freeze(alerts),
      eventsResolved: resolvedEventIds.size,
      missingEventIds: Object.freeze([...missingEventIds].sort()),
    });
  }
}

export function extractEventEntities(
  event: AlertEntityEventSource,
): readonly IncidentEntity[] {
  const entities: IncidentEntity[] = [];
  pushEntity(entities, "src_ip", event.src_endpoint?.ip);
  pushEntity(entities, "dst_ip", event.dst_endpoint?.ip);
  pushEntity(entities, "user", event.actor?.user?.name);
  pushEntity(entities, "user_id", event.actor?.user?.uid);
  pushEntity(entities, "host", event.device?.hostname);
  pushEntity(entities, "src_host", event.src_endpoint?.hostname);
  return normalizeIncidentEntities(entities);
}

function indexEvents(
  orgId: string,
  events: readonly AlertEntityEventSource[],
): ReadonlyMap<string, AlertEntityEventSource> {
  const indexed = new Map<string, AlertEntityEventSource>();
  for (const event of events) {
    const eventId = requireNonBlank(event.event_id, "event_id");
    if (event.org_id !== orgId) {
      throw new Error(
        `Normalized event ${eventId} crossed the incident organization boundary.`,
      );
    }
    if (indexed.has(eventId)) {
      throw new Error(`Duplicate normalized event identity: ${eventId}.`);
    }
    indexed.set(eventId, event);
  }
  return indexed;
}

function pushEntity(
  entities: IncidentEntity[],
  type: IncidentEntity["type"],
  value: string | undefined,
): void {
  if (value !== undefined && value.trim().length > 0) {
    entities.push({ type, value });
  }
}

function requireOrgId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error("Incident orgId must contain 1 to 100 characters.");
  }
  return normalized;
}

function requireNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }
  return normalized;
}
