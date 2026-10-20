import type { IncidentRecord } from "../../../database/repositories/incidents/incident.repository.js";
import type {
  IncidentCorrelationCandidateInput,
  IncidentCorrelationConfiguration,
  IncidentEntity,
  IncidentEntityType,
} from "../domain/incident.contracts.js";
import { normalizeIncidentEntities } from "../domain/incident-entity.js";
import type { UnifiedAlert } from "../domain/unified-alert.contracts.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const DEFAULT_CORRELATION_ENTITY_TYPES: readonly IncidentEntityType[] =
  Object.freeze(["user", "src_ip", "dst_ip", "host"]);

export const DEFAULT_INCIDENT_CORRELATION_CONFIGURATION: IncidentCorrelationConfiguration =
  Object.freeze({
    timeWindowMinutes: 15,
    maxDurationHours: 24,
    entityTypes: DEFAULT_CORRELATION_ENTITY_TYPES,
    candidateLimit: 25,
  });

export interface RankedIncidentCandidate {
  readonly incident: IncidentRecord;
  readonly sharedEntities: readonly IncidentEntity[];
  readonly entityOverlapCount: number;
  readonly sourceMatches: boolean;
}

export interface RankIncidentCandidatesInput {
  readonly alert: UnifiedAlert;
  readonly candidates: readonly IncidentRecord[];
  readonly evaluatedAt?: Date;
}

export interface RankIncidentCandidatesResult {
  readonly selected: IncidentRecord | null;
  readonly ranked: readonly RankedIncidentCandidate[];
  readonly expiredCandidateIds: readonly string[];
}

export interface IncidentCandidateRepositoryPort {
  findOpenCandidates(
    input: IncidentCorrelationCandidateInput,
  ): Promise<readonly IncidentRecord[]>;
}

export interface SelectIncidentCandidateInput {
  readonly alert: UnifiedAlert;
  readonly evaluatedAt?: Date;
}

export class IncidentCandidateRanker {
  private readonly configuration: IncidentCorrelationConfiguration;

  public constructor(
    configuration: IncidentCorrelationConfiguration =
      DEFAULT_INCIDENT_CORRELATION_CONFIGURATION,
  ) {
    this.configuration = validateConfiguration(configuration);
  }

  public rank(input: RankIncidentCandidatesInput): RankIncidentCandidatesResult {
    const evaluatedAt = validDate(input.evaluatedAt ?? input.alert.timestamp, "evaluatedAt");
    const alertTimestamp = validDate(input.alert.timestamp, "alert.timestamp");
    const alertEntities = eligibleEntities(input.alert.entities, this.configuration.entityTypes);
    const expiredCandidateIds: string[] = [];
    const ranked: RankedIncidentCandidate[] = [];

    for (const candidate of input.candidates) {
      if (candidate.orgId !== input.alert.orgId) {
        throw new Error(
          `Incident candidate ${candidate.id} crossed the organization boundary.`,
        );
      }
      if (candidate.status !== "open" && candidate.status !== "investigating") {
        continue;
      }
      const lastEventAt = candidate.lastEventAt;
      if (lastEventAt === null) continue;

      if (
        evaluatedAt.getTime() - candidate.createdAt.getTime() >=
        this.configuration.maxDurationHours * HOUR_MS
      ) {
        expiredCandidateIds.push(candidate.id);
        continue;
      }

      if (
        Math.abs(alertTimestamp.getTime() - lastEventAt.getTime()) >
        this.configuration.timeWindowMinutes * MINUTE_MS
      ) {
        continue;
      }

      const sharedEntities = intersectEntities(alertEntities, candidate.entities);
      if (sharedEntities.length === 0) continue;

      ranked.push(
        Object.freeze({
          incident: candidate,
          sharedEntities,
          entityOverlapCount: sharedEntities.length,
          sourceMatches:
            candidate.source === "both" || candidate.source === input.alert.type,
        }),
      );
    }

    ranked.sort(compareCandidates);
    const frozenRanked = Object.freeze(ranked);
    return Object.freeze({
      selected: frozenRanked[0]?.incident ?? null,
      ranked: frozenRanked,
      expiredCandidateIds: Object.freeze([...expiredCandidateIds].sort()),
    });
  }
}

export class IncidentCandidateSelector {
  private readonly configuration: IncidentCorrelationConfiguration;
  private readonly ranker: IncidentCandidateRanker;

  public constructor(
    private readonly repository: IncidentCandidateRepositoryPort,
    configuration: IncidentCorrelationConfiguration =
      DEFAULT_INCIDENT_CORRELATION_CONFIGURATION,
  ) {
    this.configuration = validateConfiguration(configuration);
    this.ranker = new IncidentCandidateRanker(this.configuration);
  }

  public async select(
    input: SelectIncidentCandidateInput,
  ): Promise<RankIncidentCandidatesResult> {
    const timestamp = validDate(input.alert.timestamp, "alert.timestamp");
    const entities = eligibleEntities(
      input.alert.entities,
      this.configuration.entityTypes,
    );
    if (entities.length === 0) {
      return Object.freeze({
        selected: null,
        ranked: Object.freeze([]),
        expiredCandidateIds: Object.freeze([]),
      });
    }

    const candidates = await this.repository.findOpenCandidates({
      orgId: input.alert.orgId,
      entities,
      activeAfter: new Date(
        timestamp.getTime() - this.configuration.timeWindowMinutes * MINUTE_MS,
      ),
      limit: this.configuration.candidateLimit,
    });
    return this.ranker.rank({ ...input, candidates });
  }
}

function eligibleEntities(
  entities: readonly IncidentEntity[],
  allowedTypes: readonly IncidentEntityType[],
): readonly IncidentEntity[] {
  const allowed = new Set(allowedTypes);
  return normalizeIncidentEntities(entities).filter((entity) => allowed.has(entity.type));
}

function intersectEntities(
  alertEntities: readonly IncidentEntity[],
  incidentEntities: readonly IncidentEntity[],
): readonly IncidentEntity[] {
  const incidentKeys = new Set(
    normalizeIncidentEntities(incidentEntities).map(entityKey),
  );
  return Object.freeze(alertEntities.filter((entity) => incidentKeys.has(entityKey(entity))));
}

function entityKey(entity: IncidentEntity): string {
  return `${entity.type}\u0000${entity.value}`;
}

function compareCandidates(
  left: RankedIncidentCandidate,
  right: RankedIncidentCandidate,
): number {
  return (
    right.entityOverlapCount - left.entityOverlapCount ||
    dateValue(right.incident.lastEventAt) - dateValue(left.incident.lastEventAt) ||
    Number(right.sourceMatches) - Number(left.sourceMatches) ||
    left.incident.createdAt.getTime() - right.incident.createdAt.getTime() ||
    left.incident.id.localeCompare(right.incident.id)
  );
}

function dateValue(value: Date | null): number {
  return value?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function validateConfiguration(
  input: IncidentCorrelationConfiguration,
): IncidentCorrelationConfiguration {
  positiveNumber(input.timeWindowMinutes, "timeWindowMinutes");
  positiveNumber(input.maxDurationHours, "maxDurationHours");
  if (!Number.isInteger(input.candidateLimit) || input.candidateLimit < 1 || input.candidateLimit > 100) {
    throw new Error("candidateLimit must be an integer between 1 and 100.");
  }
  const entityTypes = [...new Set(input.entityTypes)];
  if (entityTypes.length === 0) {
    throw new Error("entityTypes must contain at least one entity type.");
  }
  return Object.freeze({ ...input, entityTypes: Object.freeze(entityTypes) });
}

function positiveNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
}

function validDate(value: Date, fieldName: string): Date {
  const copy = new Date(value.getTime());
  if (!Number.isFinite(copy.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }
  return copy;
}
