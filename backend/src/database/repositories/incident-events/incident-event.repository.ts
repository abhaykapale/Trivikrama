import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface IncidentEventRecord {
  readonly id: string;
  readonly incidentId: string;
  readonly eventId: string;
  readonly eventTime: Date;
  readonly classUid: number | null;
  readonly severityId: number | null;
  readonly srcIp: string | null;
  readonly dstIp: string | null;
  readonly username: string | null;
  readonly hostname: string | null;
  readonly createdAt: Date;
}

export interface CreateIncidentEventInput {
  readonly id?: string;
  readonly incidentId: string;
  readonly eventId: string;
  readonly eventTime: Date;
  readonly classUid?: number | null;
  readonly severityId?: number | null;
  readonly srcIp?: string | null;
  readonly dstIp?: string | null;
  readonly username?: string | null;
  readonly hostname?: string | null;
}

export interface IncidentEventListFilters extends PaginationOptions {
  readonly incidentId?: string;
  readonly eventId?: string;
  readonly eventTimeFrom?: Date;
  readonly eventTimeTo?: Date;
  readonly classUid?: number;
  readonly severityId?: number;
  readonly srcIp?: string;
  readonly dstIp?: string;
  readonly username?: string;
  readonly hostname?: string;
}

export interface DeleteIncidentEventLinkInput {
  readonly incidentId: string;
  readonly eventId: string;
  readonly eventTime: Date;
}

export interface IIncidentEventRepository {
  withTransaction(transaction: TransactionClient): IIncidentEventRepository;
  create(input: CreateIncidentEventInput): Promise<IncidentEventRecord>;
  createMany(inputs: readonly CreateIncidentEventInput[]): Promise<readonly IncidentEventRecord[]>;
  findById(id: string): Promise<IncidentEventRecord | null>;
  list(filters?: IncidentEventListFilters): Promise<PageResult<IncidentEventRecord>>;
  listByIncident(incidentId: string, filters?: PaginationOptions): Promise<PageResult<IncidentEventRecord>>;
  deleteLink(input: DeleteIncidentEventLinkInput): Promise<boolean>;
}
