import type {
  IncidentEntity,
  IncidentSeverity,
  IncidentStatus,
} from "./incident.contracts.js";

export interface GetIncidentContextQuery {
  readonly incidentId: string;
  readonly orgId: string;
}

export interface IncidentContextRepositoryQuery extends GetIncidentContextQuery {
  readonly entities: readonly IncidentEntity[];
  readonly historySince: Date;
  readonly previousIncidentLimit: number;
}

export interface PreviousIncidentContextView {
  readonly id: string;
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly createdAt: Date;
}

export interface IncidentAssetContextView {
  readonly name: string;
  readonly assetType: string;
  readonly ipAddress: string | null;
  readonly criticality: number;
  readonly owner: string | null;
  readonly department: string | null;
  readonly tags: readonly unknown[];
}

export interface IncidentEntityHistoryView {
  readonly firstSeenAt: Date | null;
  readonly incidentCount30d: number;
  readonly alertCount30d: number;
}

export interface IncidentContextRepositoryResult {
  readonly previousIncidents: readonly PreviousIncidentContextView[];
  readonly assets: readonly IncidentAssetContextView[];
  readonly entityHistory: Readonly<
    Record<string, IncidentEntityHistoryView>
  >;
}

export interface IIncidentContextRepository {
  getContext(
    input: IncidentContextRepositoryQuery,
  ): Promise<IncidentContextRepositoryResult>;
}

export type GetIncidentContextResult = IncidentContextRepositoryResult;
