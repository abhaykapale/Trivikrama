import type { Collection, Filter, Sort } from "mongodb";

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

export class MongoAiResultRepository implements IAiResultRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(input: CreateAiResultInput): Promise<AiResultDocument> {
    validateAiResult(input);
    await this.collection().insertOne(input);
    return input;
  }

  public async createMany(inputs: readonly CreateAiResultInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    for (const input of inputs) {
      validateAiResult(input);
    }

    const result = await this.collection().insertMany([...inputs], {
      ordered: false,
    });
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
    return this.list({ ...options, batchId: requireNonBlank(batchId, "batchId") });
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
  const clauses: Filter<AiResultDocument>[] = [];

  if (filters.orgId !== undefined) {
    clauses.push({
      org_id: requireNonBlank(filters.orgId, "orgId"),
    });
  }

  if (filters.eventId !== undefined) {
    clauses.push({
      event_id: requireNonBlank(filters.eventId, "eventId"),
    });
  }

  if (filters.batchId !== undefined) {
    clauses.push({
      batch_id: requireNonBlank(filters.batchId, "batchId"),
    });
  }

  if (filters.modelName !== undefined) {
    clauses.push({
      model_name: requireNonBlank(filters.modelName, "modelName"),
    });
  }

  if (filters.modelVersion !== undefined) {
    clauses.push({
      model_version: requireNonBlank(filters.modelVersion, "modelVersion"),
    });
  }

  if (filters.isAnomaly !== undefined) {
    clauses.push({
      is_anomaly: filters.isAnomaly,
    });
  }

  if (filters.minAnomalyScore !== undefined) {
    assertNumberRange(filters.minAnomalyScore, "minAnomalyScore", 0, 1);

    clauses.push({
      anomaly_score: {
        $gte: filters.minAnomalyScore,
      },
    });
  }

  if (filters.threatCategory !== undefined) {
    clauses.push({
      threat_category: requireNonBlank(
        filters.threatCategory,
        "threatCategory",
      ),
    });
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    clauses.push({
      created_at: {
        ...(filters.from !== undefined ? { $gte: filters.from } : {}),
        ...(filters.to !== undefined ? { $lte: filters.to } : {}),
      },
    });
  }

  return clauses.length === 0
    ? {}
    : {
        $and: clauses,
      };
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
