export type EventQuerySortField = "time" | "severityId";
export type EventQuerySortOrder = "asc" | "desc";

export interface EventSearchInput {
  readonly orgId: string;
  readonly query?: string;
  readonly classUid?: number;
  readonly severityId?: number;
  readonly srcIp?: string;
  readonly dstIp?: string;
  readonly username?: string;
  readonly hostname?: string;
  readonly collectorId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly limit: number;
  readonly sort: EventQuerySortField;
  readonly order: EventQuerySortOrder;
}

export interface EventRepositorySearchQuery {
  readonly orgId: string;
  readonly query?: string;
  readonly classUid?: number;
  readonly severityId?: number;
  readonly srcIp?: string;
  readonly dstIp?: string;
  readonly username?: string;
  readonly hostname?: string;
  readonly collectorId?: string;
  readonly from: Date;
  readonly to: Date;
  readonly offset: number;
  readonly limit: number;
  readonly sort: EventQuerySortField;
  readonly order: EventQuerySortOrder;
}

export interface EventEndpointView {
  readonly ip?: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly mac?: string;
}

export interface EventActorView {
  readonly user?: {
    readonly name?: string;
    readonly uid?: string;
    readonly domain?: string;
    readonly type?: string;
  };
  readonly process?: EventProcessView;
  readonly session?: {
    readonly uid?: string;
    readonly type?: string;
  };
}

export interface EventProcessView {
  readonly name?: string;
  readonly pid?: number;
  readonly cmd_line?: string;
  readonly path?: string;
}

export interface EventInvestigationView {
  readonly eventId: string;
  readonly classUid: number;
  readonly categoryUid: number;
  readonly severityId: number;
  readonly statusId?: number;
  readonly duration?: number;
  readonly time: Date;
  readonly message: string;
  readonly srcEndpoint?: EventEndpointView;
  readonly dstEndpoint?: EventEndpointView;
  readonly actor?: EventActorView;
  readonly process?: EventProcessView;
  readonly query?: { readonly hostname?: string };
  readonly device?: {
    readonly hostname?: string;
    readonly ip?: string;
    readonly os?: { readonly name?: string; readonly version?: string };
    readonly type?: string;
  };
  readonly metadata: {
    readonly version: string;
    readonly product?: Readonly<Record<string, unknown>>;
    readonly log_level?: string;
  };
  readonly enrichments?: Readonly<Record<string, unknown>>;
  readonly features?: Readonly<Record<string, unknown>>;
  readonly ingestion: {
    readonly batchId: string;
    readonly collectorId: string;
    readonly ingestedAt: Date;
    readonly pipelineDurationMs?: number;
  };
}

export interface EventAiAnalysisView {
  readonly modelName: string;
  readonly modelVersion: string;
  readonly anomalyScore: number;
  readonly isAnomaly: boolean;
  readonly confidence?: number;
  readonly threatCategory?: string;
  readonly threatConfidence?: number;
  readonly shapExplanation?: {
    readonly baseValue?: number;
    readonly features: readonly {
      readonly name: string;
      readonly value: number;
      readonly shapValue: number;
    }[];
  };
  readonly processingTimeMs?: number;
  readonly usedFallback: boolean;
  readonly createdAt: Date;
}

export interface EventDetailView extends EventInvestigationView {
  readonly aiAnalysis: EventAiAnalysisView | null;
}

export interface EventRepositoryPage {
  readonly items: readonly EventInvestigationView[];
  readonly total: number;
}

export interface EventPaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface SearchEventsResult {
  readonly data: readonly EventInvestigationView[];
  readonly pagination: EventPaginationView;
  readonly window: {
    readonly from: Date;
    readonly to: Date;
  };
}

export interface GetEventDetailInput {
  readonly orgId: string;
  readonly eventId: string;
}

export interface IEventInvestigationRepository {
  search(input: EventRepositorySearchQuery): Promise<EventRepositoryPage>;
  findById(input: GetEventDetailInput): Promise<EventDetailView | null>;
}

export interface EventQueryClock {
  now(): Date;
}

export const eventQuerySystemClock: EventQueryClock = {
  now: () => new Date(),
};

export const EVENT_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const EVENT_EXPORT_BATCH_SIZE = 200;
export const EVENT_EXPORT_MAX_RESULTS = 10_000;

export class InvalidEventTimeRangeError extends Error {
  public readonly code = "INVALID_EVENT_TIME_RANGE";

  public constructor() {
    super("from must be earlier than or equal to to");
    this.name = "InvalidEventTimeRangeError";
  }
}
