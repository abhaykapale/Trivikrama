import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface IncidentNoteRecord {
  readonly id: string;
  readonly incidentId: string;
  readonly authorId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateIncidentNoteInput {
  readonly id?: string;
  readonly incidentId: string;
  readonly authorId: string;
  readonly content: string;
}

export interface UpdateIncidentNoteInput {
  readonly content: string;
}

export interface IncidentNoteListFilters extends PaginationOptions {
  readonly incidentId?: string;
  readonly authorId?: string;
}

export interface IIncidentNoteRepository {
  withTransaction(transaction: TransactionClient): IIncidentNoteRepository;
  create(input: CreateIncidentNoteInput): Promise<IncidentNoteRecord>;
  findById(id: string): Promise<IncidentNoteRecord | null>;
  list(filters?: IncidentNoteListFilters): Promise<PageResult<IncidentNoteRecord>>;
  listByIncident(incidentId: string, filters?: PaginationOptions): Promise<PageResult<IncidentNoteRecord>>;
  update(id: string, input: UpdateIncidentNoteInput): Promise<IncidentNoteRecord | null>;
  delete(id: string): Promise<boolean>;
}
