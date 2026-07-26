import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";
import type { IncidentSeverity } from "../incidents/incident.repository.js";

export type AlertType = "rule" | "ai";
export type AlertSeverity = IncidentSeverity;

export interface AlertRecord {
  readonly id: string;
  readonly incidentId: string | null;
  readonly alertType: AlertType;
  readonly ruleId: string | null;
  readonly ruleName: string | null;
  readonly matchedCondition: string | null;
  readonly anomalyScore: number | null;
  readonly confidence: number | null;
  readonly threatCategory: string | null;
  readonly modelVersion: string | null;
  readonly shapValues: Record<string, unknown> | null;
  readonly severity: AlertSeverity;
  readonly weight: number;
  readonly tags: readonly unknown[];
  readonly metadata: Record<string, unknown>;
  readonly matchedEventIds: readonly unknown[];
  readonly createdAt: Date;
  readonly orgId: string;
}

export interface CreateAlertInput {
  readonly id?: string;
  readonly incidentId?: string | null;
  readonly alertType: AlertType;
  readonly ruleId?: string | null;
  readonly ruleName?: string | null;
  readonly matchedCondition?: string | null;
  readonly anomalyScore?: number | null;
  readonly confidence?: number | null;
  readonly threatCategory?: string | null;
  readonly modelVersion?: string | null;
  readonly shapValues?: Record<string, unknown> | null;
  readonly severity?: AlertSeverity;
  readonly weight?: number;
  readonly tags?: readonly unknown[];
  readonly metadata?: Record<string, unknown>;
  readonly matchedEventIds?: readonly unknown[];
  readonly orgId?: string;
}

export interface UpdateAlertInput {
  readonly incidentId?: string | null;
  readonly ruleId?: string | null;
  readonly ruleName?: string | null;
  readonly matchedCondition?: string | null;
  readonly anomalyScore?: number | null;
  readonly confidence?: number | null;
  readonly threatCategory?: string | null;
  readonly modelVersion?: string | null;
  readonly shapValues?: Record<string, unknown> | null;
  readonly severity?: AlertSeverity;
  readonly weight?: number;
  readonly tags?: readonly unknown[];
  readonly metadata?: Record<string, unknown>;
  readonly matchedEventIds?: readonly unknown[];
}

export interface AlertListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly incidentId?: string | null;
  readonly alertType?: AlertType;
  readonly ruleId?: string;
  readonly severity?: AlertSeverity;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
}

export interface IAlertRepository {
  withTransaction(transaction: TransactionClient): IAlertRepository;
  create(input: CreateAlertInput): Promise<AlertRecord>;
  createMany(inputs: readonly CreateAlertInput[]): Promise<readonly AlertRecord[]>;
  findById(id: string): Promise<AlertRecord | null>;
  list(filters?: AlertListFilters): Promise<PageResult<AlertRecord>>;
  listByIncident(incidentId: string, filters?: PaginationOptions): Promise<PageResult<AlertRecord>>;
  update(id: string, input: UpdateAlertInput): Promise<AlertRecord | null>;
}
