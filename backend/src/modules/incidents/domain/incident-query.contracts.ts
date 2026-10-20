import type {
  IncidentEntity,
  IncidentEntityType,
  IncidentKillChainStage,
  IncidentScoreBreakdown,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from "./incident.contracts.js";

export type IncidentQuerySortField =
  | "createdAt"
  | "riskScore"
  | "severity"
  | "alertCount"
  | "updatedAt";

export type IncidentQuerySortOrder = "asc" | "desc";

export interface IncidentQueryRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: IncidentStatus;
  readonly severity: IncidentSeverity;
  readonly riskScore: number;
  readonly source: IncidentSource;
  readonly scoreBreakdown: IncidentScoreBreakdown;
  readonly primaryEntity: string | null;
  readonly entityType: IncidentEntityType | null;
  readonly entities: readonly IncidentEntity[];
  readonly killChainStages: readonly IncidentKillChainStage[];
  readonly alertCount: number;
  readonly eventCount: number;
  readonly assignedTo: string | null;
  readonly firstEventAt: Date | null;
  readonly lastEventAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
}

export interface ListIncidentsQuery {
  readonly orgId: string;
  readonly page: number;
  readonly limit: number;
  readonly status?: readonly IncidentStatus[];
  readonly severity?: readonly IncidentSeverity[];
  readonly source?: readonly IncidentSource[];
  readonly assignedTo?: string;
  readonly search?: string;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly sort: IncidentQuerySortField;
  readonly order: IncidentQuerySortOrder;
}

export interface IncidentQueryPage {
  readonly items: readonly IncidentQueryRecord[];
  readonly total: number;
}

export interface GetIncidentQuery {
  readonly incidentId: string;
  readonly orgId: string;
}

export interface IIncidentQueryRepository {
  list(input: ListIncidentsQuery): Promise<IncidentQueryPage>;
  findById(input: GetIncidentQuery): Promise<IncidentQueryRecord | null>;
}

export interface IncidentPaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface ListIncidentsResult {
  readonly data: readonly IncidentQueryRecord[];
  readonly pagination: IncidentPaginationView;
}
