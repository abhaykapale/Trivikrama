import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";
import type {
  IncidentCorrelationCandidateInput,
  IncidentEntity,
  IncidentEntityType,
  IncidentKillChainStage,
  IncidentScoreBreakdown,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from "../../../modules/incidents/domain/incident.contracts.js";

export type {
  IncidentEntity,
  IncidentEntityType,
  IncidentKillChainStage,
  IncidentScoreBreakdown,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
} from "../../../modules/incidents/domain/incident.contracts.js";

export interface IncidentRecord {
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
  readonly orgId: string;
}

export interface CreateIncidentInput {
  readonly id?: string;
  readonly title: string;
  readonly description?: string | null;
  readonly status?: IncidentStatus;
  readonly severity?: IncidentSeverity;
  readonly riskScore?: number;
  readonly source?: IncidentSource;
  readonly scoreBreakdown?: IncidentScoreBreakdown;
  readonly primaryEntity?: string | null;
  readonly entityType?: IncidentEntityType | null;
  readonly entities?: readonly IncidentEntity[];
  readonly killChainStages?: readonly IncidentKillChainStage[];
  readonly alertCount?: number;
  readonly eventCount?: number;
  readonly assignedTo?: string | null;
  readonly firstEventAt?: Date | null;
  readonly lastEventAt?: Date | null;
  readonly resolvedAt?: Date | null;
  readonly closedAt?: Date | null;
  readonly orgId?: string;
}

export interface UpdateIncidentInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: IncidentStatus;
  readonly severity?: IncidentSeverity;
  readonly riskScore?: number;
  readonly source?: IncidentSource;
  readonly scoreBreakdown?: IncidentScoreBreakdown;
  readonly primaryEntity?: string | null;
  readonly entityType?: IncidentEntityType | null;
  readonly entities?: readonly IncidentEntity[];
  readonly killChainStages?: readonly IncidentKillChainStage[];
  readonly alertCount?: number;
  readonly eventCount?: number;
  readonly assignedTo?: string | null;
  readonly firstEventAt?: Date | null;
  readonly lastEventAt?: Date | null;
  readonly resolvedAt?: Date | null;
  readonly closedAt?: Date | null;
}

export interface IncidentListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly status?: IncidentStatus | readonly IncidentStatus[];
  readonly severity?: IncidentSeverity | readonly IncidentSeverity[];
  readonly source?: IncidentSource | readonly IncidentSource[];
  readonly assignedTo?: string | null;
  readonly primaryEntity?: string;
  readonly entityType?: IncidentEntityType;
  readonly minRiskScore?: number;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly search?: string;
}

export interface IncidentStatusTransitionInput {
  readonly status: IncidentStatus;
  readonly resolvedAt?: Date | null;
  readonly closedAt?: Date | null;
}

export interface IIncidentRepository {
  withTransaction(transaction: TransactionClient): IIncidentRepository;
  create(input: CreateIncidentInput): Promise<IncidentRecord>;
  findById(id: string): Promise<IncidentRecord | null>;
  findOpenCandidates(
    input: IncidentCorrelationCandidateInput,
  ): Promise<readonly IncidentRecord[]>;
  findOpenCandidatesForUpdate(
    input: IncidentCorrelationCandidateInput,
  ): Promise<readonly IncidentRecord[]>;
  list(filters?: IncidentListFilters): Promise<PageResult<IncidentRecord>>;
  update(id: string, input: UpdateIncidentInput): Promise<IncidentRecord | null>;
  assign(id: string, assignedTo: string | null): Promise<IncidentRecord | null>;
  transitionStatus(id: string, input: IncidentStatusTransitionInput): Promise<IncidentRecord | null>;
}
