import {
  ensureNonBlank,
  pageByLimitOffset,
  toRequiredDate,
  type PageResult,
  type PaginationOptions,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  CreateIncidentEventInput,
  DeleteIncidentEventLinkInput,
  IIncidentEventRepository,
  IncidentEventListFilters,
  IncidentEventRecord,
} from "./incident-event.repository.js";

interface IncidentEventRow {
  readonly id: string;
  readonly incident_id: string;
  readonly event_id: string;
  readonly event_time: Date | string;
  readonly class_uid: number | null;
  readonly severity_id: number | null;
  readonly src_ip: string | null;
  readonly dst_ip: string | null;
  readonly username: string | null;
  readonly hostname: string | null;
  readonly created_at: Date | string;
}

const INCIDENT_EVENTS_TABLE = "public.incident_events";

export class PostgresIncidentEventRepository implements IIncidentEventRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IIncidentEventRepository {
    return new PostgresIncidentEventRepository(transaction);
  }

  public async create(input: CreateIncidentEventInput): Promise<IncidentEventRecord> {
    const [row] = await this.db<IncidentEventRow>(INCIDENT_EVENTS_TABLE)
      .insert(toInsertableIncidentEvent(input))
      .returning("*");

    return mapIncidentEventRow(row);
  }

  public async createMany(inputs: readonly CreateIncidentEventInput[]): Promise<readonly IncidentEventRecord[]> {
    if (inputs.length === 0) {
      return [];
    }

    const rows = await this.db<IncidentEventRow>(INCIDENT_EVENTS_TABLE)
      .insert(inputs.map(toInsertableIncidentEvent))
      .returning("*");

    return rows.map(mapIncidentEventRow);
  }

  public async findById(id: string): Promise<IncidentEventRecord | null> {
    const row = await this.baseQuery()
      .where("id", ensureNonBlank(id, "id"))
      .orderBy("event_time", "desc")
      .first<IncidentEventRow>();

    return row ? mapIncidentEventRow(row) : null;
  }

  public async list(filters: IncidentEventListFilters = {}): Promise<PageResult<IncidentEventRecord>> {
    const query = this.baseQuery().orderBy("event_time", "asc").orderBy("id", "asc");

    if (filters.incidentId !== undefined) {
      query.where("incident_id", ensureNonBlank(filters.incidentId, "incidentId"));
    }

    if (filters.eventId !== undefined) {
      query.where("event_id", ensureNonBlank(filters.eventId, "eventId"));
    }

    if (filters.eventTimeFrom !== undefined) {
      query.where("event_time", ">=", filters.eventTimeFrom);
    }

    if (filters.eventTimeTo !== undefined) {
      query.where("event_time", "<", filters.eventTimeTo);
    }

    if (filters.classUid !== undefined) {
      validateInteger(filters.classUid, "classUid");
      query.where("class_uid", filters.classUid);
    }

    if (filters.severityId !== undefined) {
      validateInteger(filters.severityId, "severityId");
      query.where("severity_id", filters.severityId);
    }

    if (filters.srcIp !== undefined) {
      query.where("src_ip", ensureNonBlank(filters.srcIp, "srcIp"));
    }

    if (filters.dstIp !== undefined) {
      query.where("dst_ip", ensureNonBlank(filters.dstIp, "dstIp"));
    }

    if (filters.username !== undefined) {
      query.where("username", ensureNonBlank(filters.username, "username"));
    }

    if (filters.hostname !== undefined) {
      query.where("hostname", ensureNonBlank(filters.hostname, "hostname"));
    }

    return pageByLimitOffset<IncidentEventRow, IncidentEventRecord>(query, filters, mapIncidentEventRow);
  }

  public async listByIncident(incidentId: string, filters: PaginationOptions = {}): Promise<PageResult<IncidentEventRecord>> {
    return this.list({ ...filters, incidentId });
  }

  public async deleteLink(input: DeleteIncidentEventLinkInput): Promise<boolean> {
    const deleted = await this.db<IncidentEventRow>(INCIDENT_EVENTS_TABLE)
      .where("incident_id", ensureNonBlank(input.incidentId, "incidentId"))
      .andWhere("event_id", ensureNonBlank(input.eventId, "eventId"))
      .andWhere("event_time", input.eventTime)
      .delete();

    return deleted > 0;
  }

  private baseQuery() {
    return this.db<IncidentEventRow>(INCIDENT_EVENTS_TABLE).select("*");
  }
}

function toInsertableIncidentEvent(input: CreateIncidentEventInput): Record<string, unknown> {
  validateInteger(input.classUid ?? null, "classUid", true);
  validateInteger(input.severityId ?? null, "severityId", true);

  return {
    ...(input.id ? { id: input.id } : {}),
    incident_id: ensureNonBlank(input.incidentId, "incidentId"),
    event_id: ensureNonBlank(input.eventId, "eventId"),
    event_time: input.eventTime,
    class_uid: input.classUid ?? null,
    severity_id: input.severityId ?? null,
    src_ip: input.srcIp ?? null,
    dst_ip: input.dstIp ?? null,
    username: input.username ?? null,
    hostname: input.hostname ?? null,
  };
}

function validateInteger(value: number | null, fieldName: string, nullable = false): void {
  if (value === null && nullable) {
    return;
  }

  if (value === null || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
}

function mapIncidentEventRow(row: IncidentEventRow): IncidentEventRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    eventId: row.event_id,
    eventTime: toRequiredDate(row.event_time),
    classUid: row.class_uid,
    severityId: row.severity_id,
    srcIp: row.src_ip,
    dstIp: row.dst_ip,
    username: row.username,
    hostname: row.hostname,
    createdAt: toRequiredDate(row.created_at),
  };
}
