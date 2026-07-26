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
  CreateIncidentNoteInput,
  IIncidentNoteRepository,
  IncidentNoteListFilters,
  IncidentNoteRecord,
  UpdateIncidentNoteInput,
} from "./incident-note.repository.js";

interface IncidentNoteRow {
  readonly id: string;
  readonly incident_id: string;
  readonly author_id: string;
  readonly content: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const INCIDENT_NOTES_TABLE = "public.incident_notes";

export class PostgresIncidentNoteRepository implements IIncidentNoteRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IIncidentNoteRepository {
    return new PostgresIncidentNoteRepository(transaction);
  }

  public async create(input: CreateIncidentNoteInput): Promise<IncidentNoteRecord> {
    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      incident_id: ensureNonBlank(input.incidentId, "incidentId"),
      author_id: ensureNonBlank(input.authorId, "authorId"),
      content: ensureNonBlank(input.content, "content"),
    };

    const [row] = await this.db<IncidentNoteRow>(INCIDENT_NOTES_TABLE).insert(insertable).returning("*");
    return mapIncidentNoteRow(row);
  }

  public async findById(id: string): Promise<IncidentNoteRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<IncidentNoteRow>();
    return row ? mapIncidentNoteRow(row) : null;
  }

  public async list(filters: IncidentNoteListFilters = {}): Promise<PageResult<IncidentNoteRecord>> {
    const query = this.baseQuery().orderBy("created_at", "asc").orderBy("id", "asc");

    if (filters.incidentId !== undefined) {
      query.where("incident_id", ensureNonBlank(filters.incidentId, "incidentId"));
    }

    if (filters.authorId !== undefined) {
      query.where("author_id", ensureNonBlank(filters.authorId, "authorId"));
    }

    return pageByLimitOffset<IncidentNoteRow, IncidentNoteRecord>(query, filters, mapIncidentNoteRow);
  }

  public async listByIncident(incidentId: string, filters: PaginationOptions = {}): Promise<PageResult<IncidentNoteRecord>> {
    return this.list({ ...filters, incidentId });
  }

  public async update(id: string, input: UpdateIncidentNoteInput): Promise<IncidentNoteRecord | null> {
    const [row] = await this.db<IncidentNoteRow>(INCIDENT_NOTES_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update({ content: ensureNonBlank(input.content, "content") })
      .returning("*");

    return row ? mapIncidentNoteRow(row) : null;
  }

  public async delete(id: string): Promise<boolean> {
    const deleted = await this.db<IncidentNoteRow>(INCIDENT_NOTES_TABLE).where("id", ensureNonBlank(id, "id")).delete();
    return deleted > 0;
  }

  private baseQuery() {
    return this.db<IncidentNoteRow>(INCIDENT_NOTES_TABLE).select("*");
  }
}

function mapIncidentNoteRow(row: IncidentNoteRow): IncidentNoteRecord {
  return {
    id: row.id,
    incidentId: row.incident_id,
    authorId: row.author_id,
    content: row.content,
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
  };
}
