import type { Collection, Filter, Sort } from "mongodb";

import {
  removeUndefined,
  toMongoDouble,
  toMongoInt,
  type MongoInsertDocument,
} from "./mongo-document.helpers.js";


import type { MongoDbClient } from "../../mongodb/client.js";
import {
  assertNonNegativeInteger,
  assertNumberRange,
  normalizeMongoPagination,
  requireMongoDatabase,
  requireNonBlank,
  type MongoPageResult,
  type MongoPaginationOptions,
} from "./mongo-repository.types.js";
import type {
  AiResultDocument,
  AiResultListFilters,
  CreateAiResultInput,
  IAiResultRepository,
} from "./ai-result.repository.js";

const COLLECTION_NAME = "ai_results";

type MutableMongoFilter = Record<string, unknown>;

export class MongoAiResultRepository implements IAiResultRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(input: CreateAiResultInput): Promise<AiResultDocument> {
    validateAiResult(input);
    await this.collection().insertOne(toMongoAiResultDocument(input) as never);
    return input;
  }

  public async createMany(
    inputs: readonly CreateAiResultInput[],
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    for (const input of inputs) {
      validateAiResult(input);
    }

    const result = await this.collection().insertMany(
      inputs.map((input) => toMongoAiResultDocument(input)) as never,
      {
        ordered: false,
      },
    );
    return result.insertedCount;
  }

  public async findLatestByEventId(
    eventId: string,
  ): Promise<AiResultDocument | null> {
    return this.collection()
      .find({ event_id: requireNonBlank(eventId, "eventId") })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
  }

  public async list(
    filters: AiResultListFilters = {},
  ): Promise<MongoPageResult<AiResultDocument>> {
    const { limit, offset } = normalizeMongoPagination(filters);
    const query = buildAiResultFilter(filters);
    const sort: Sort = {
      created_at: filters.sortDirection === "asc" ? 1 : -1,
      event_id: 1,
    };

    const items = await this.collection()
      .find(query)
      .sort(sort)
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    return toMongoPage(items, limit, offset);
  }

  public async listAnomalies(
    filters: Omit<AiResultListFilters, "isAnomaly"> = {},
  ): Promise<MongoPageResult<AiResultDocument>> {
    return this.list({ ...filters, isAnomaly: true });
  }

  public async listByBatchId(
    batchId: string,
    options?: MongoPaginationOptions,
  ): Promise<MongoPageResult<AiResultDocument>> {
    return this.list({
      ...options,
      batchId: requireNonBlank(batchId, "batchId"),
    });
  }

  private collection(): Collection<AiResultDocument> {
    return requireMongoDatabase(this.client).collection<AiResultDocument>(
      COLLECTION_NAME,
    );
  }
}

function buildAiResultFilter(
  filters: AiResultListFilters,
): Filter<AiResultDocument> {
  const query: MutableMongoFilter = {};

  if (filters.orgId !== undefined) {
    query.org_id = requireNonBlank(filters.orgId, "orgId");
  }

  if (filters.eventId !== undefined) {
    query.event_id = requireNonBlank(filters.eventId, "eventId");
  }

  if (filters.batchId !== undefined) {
    query.batch_id = requireNonBlank(filters.batchId, "batchId");
  }

  if (filters.modelName !== undefined) {
    query.model_name = requireNonBlank(filters.modelName, "modelName");
  }

  if (filters.modelVersion !== undefined) {
    query.model_version = requireNonBlank(filters.modelVersion, "modelVersion");
  }

  if (filters.isAnomaly !== undefined) {
    query.is_anomaly = filters.isAnomaly;
  }

  if (filters.minAnomalyScore !== undefined) {
    assertNumberRange(filters.minAnomalyScore, "minAnomalyScore", 0, 1);
    query.anomaly_score = { $gte: filters.minAnomalyScore };
  }

  if (filters.threatCategory !== undefined) {
    query.threat_category = requireNonBlank(
      filters.threatCategory,
      "threatCategory",
    );
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    const createdAt: Record<string, Date> = {};

    if (filters.from !== undefined) {
      createdAt.$gte = filters.from;
    }

    if (filters.to !== undefined) {
      createdAt.$lte = filters.to;
    }

    query.created_at = createdAt;
  }

  return query as Filter<AiResultDocument>;
}

function validateAiResult(input: CreateAiResultInput): void {
  requireNonBlank(input.event_id, "event_id");
  requireNonBlank(input.model_name, "model_name");
  requireNonBlank(input.model_version, "model_version");
  assertNumberRange(input.anomaly_score, "anomaly_score", 0, 1);

  if (input.confidence !== undefined) {
    assertNumberRange(input.confidence, "confidence", 0, 1);
  }

  if (input.threat_confidence !== undefined) {
    assertNumberRange(input.threat_confidence, "threat_confidence", 0, 1);
  }

  if (input.processing_time_ms !== undefined) {
    assertNonNegativeInteger(input.processing_time_ms, "processing_time_ms");
  }
}

function toMongoPage<TRecord>(
  rows: readonly TRecord[],
  limit: number,
  offset: number,
): MongoPageResult<TRecord> {
  return {
    items: rows.slice(0, limit),
    limit,
    offset,
    hasMore: rows.length > limit,
  };
}

function toMongoAiResultDocument(
  input: CreateAiResultInput,
): MongoInsertDocument {
  return removeUndefined({
    ...input,
    anomaly_score: toMongoDouble(input.anomaly_score, "anomaly_score"),
    confidence:
      input.confidence === undefined
        ? undefined
        : toMongoDouble(input.confidence, "confidence"),
    threat_confidence:
      input.threat_confidence === undefined
        ? undefined
        : toMongoDouble(input.threat_confidence, "threat_confidence"),
    shap_explanation:
      input.shap_explanation === undefined
        ? undefined
        : {
            ...input.shap_explanation,
            base_value:
              input.shap_explanation.base_value === undefined
                ? undefined
                : toMongoDouble(
                    input.shap_explanation.base_value,
                    "shap_explanation.base_value",
                  ),
            features: input.shap_explanation.features?.map((feature) => ({
              ...feature,
              value: toMongoDouble(
                feature.value,
                `shap_explanation.features.${feature.name}.value`,
              ),
              shap_value: toMongoDouble(
                feature.shap_value,
                `shap_explanation.features.${feature.name}.shap_value`,
              ),
            })),
          },
    processing_time_ms:
      input.processing_time_ms === undefined
        ? undefined
        : toMongoInt(input.processing_time_ms, "processing_time_ms"),
  });
}
