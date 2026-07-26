import type { MongoPageResult, MongoPaginationOptions, MongoSortDirection } from "./mongo-repository.types.js";

export interface ShapFeatureContributionDocument {
  readonly name: string;
  readonly value: number;
  readonly shap_value: number;
}

export interface AiResultDocument {
  readonly event_id: string;
  readonly batch_id?: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly anomaly_score: number;
  readonly is_anomaly: boolean;
  readonly confidence?: number;
  readonly threat_category?: string;
  readonly threat_confidence?: number;
  readonly shap_explanation?: {
    readonly base_value?: number;
    readonly features?: readonly ShapFeatureContributionDocument[];
  };
  readonly input_features?: Record<string, unknown>;
  readonly processing_time_ms?: number;
  readonly used_fallback?: boolean;
  readonly created_at: Date;
  readonly org_id?: string;
}

export type CreateAiResultInput = AiResultDocument;

export interface AiResultListFilters extends MongoPaginationOptions {
  readonly orgId?: string;
  readonly eventId?: string;
  readonly batchId?: string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly isAnomaly?: boolean;
  readonly minAnomalyScore?: number;
  readonly threatCategory?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly sortDirection?: MongoSortDirection;
}

export interface IAiResultRepository {
  create(input: CreateAiResultInput): Promise<AiResultDocument>;
  createMany(inputs: readonly CreateAiResultInput[]): Promise<number>;
  findLatestByEventId(eventId: string): Promise<AiResultDocument | null>;
  list(filters?: AiResultListFilters): Promise<MongoPageResult<AiResultDocument>>;
  listAnomalies(filters?: Omit<AiResultListFilters, "isAnomaly">): Promise<MongoPageResult<AiResultDocument>>;
  listByBatchId(batchId: string, options?: MongoPaginationOptions): Promise<MongoPageResult<AiResultDocument>>;
}
