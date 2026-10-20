import type {
  IncidentCorrelationCandidateInput,
  IncidentEntity,
  IncidentEntityType,
} from "./incident.contracts.js";

const MAX_ENTITY_VALUE_LENGTH = 255;
const ENTITY_TYPES: ReadonlySet<string> = new Set<IncidentEntityType>([
  "user",
  "user_id",
  "host",
  "src_host",
  "src_ip",
  "dst_ip",
  "collector",
  "source_type",
]);

export function normalizeIncidentEntity(entity: IncidentEntity): IncidentEntity {
  const type = requireEntityType(entity.type);
  let value = requireEntityValue(entity.value).toLowerCase();

  if (type === "user" && value.endsWith("@localhost")) {
    value = value.slice(0, -"@localhost".length);
  }

  if (type === "host" || type === "src_host") {
    value = value.split(".", 1)[0] ?? value;
  }

  if (value.length === 0) {
    throw new Error("Incident entity value must not normalize to blank.");
  }

  return Object.freeze({ type, value });
}

export function normalizeIncidentEntities(
  entities: readonly IncidentEntity[],
): readonly IncidentEntity[] {
  const unique = new Map<string, IncidentEntity>();

  for (const entity of entities) {
    const normalized = normalizeIncidentEntity(entity);
    unique.set(`${normalized.type}\u0000${normalized.value}`, normalized);
  }

  return Object.freeze([...unique.values()]);
}

export function prepareIncidentCorrelationCandidateInput(
  input: IncidentCorrelationCandidateInput,
): Readonly<Required<IncidentCorrelationCandidateInput>> {
  const orgId = input.orgId.trim();
  if (orgId.length === 0 || orgId.length > 100) {
    throw new Error("Incident orgId must contain 1 to 100 characters.");
  }

  const entities = normalizeIncidentEntities(input.entities);
  const activeAfter = new Date(input.activeAfter.getTime());
  if (!Number.isFinite(activeAfter.getTime())) {
    throw new Error("activeAfter must be a valid date.");
  }

  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100.");
  }

  return Object.freeze({ orgId, entities, activeAfter, limit });
}

function requireEntityType(value: IncidentEntityType): IncidentEntityType {
  if (!ENTITY_TYPES.has(value)) {
    throw new Error(`Unsupported incident entity type: ${String(value)}.`);
  }
  return value;
}

function requireEntityValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_ENTITY_VALUE_LENGTH) {
    throw new Error(
      `Incident entity value must contain 1 to ${MAX_ENTITY_VALUE_LENGTH} characters.`,
    );
  }
  return normalized;
}
