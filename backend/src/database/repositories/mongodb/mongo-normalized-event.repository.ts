import type { Collection, Filter, Sort } from "mongodb";

import type { MongoDbClient } from "../../mongodb/client.js";
import {
  normalizeMongoPagination,
  requireMongoDatabase,
  requireNonBlank,
  assertNumberRange,
  assertNonNegativeInteger,
  type MongoPageResult,
  type MongoPaginationOptions,
} from "./mongo-repository.types.js";
import type {
  CreateNormalizedEventInput,
  INormalizedEventRepository,
  NormalizedEventDocument,
  NormalizedEventListFilters,
} from "./normalized-event.repository.js";

const COLLECTION_NAME = "normalized_events";

export class MongoNormalizedEventRepository implements INormalizedEventRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(
    input: CreateNormalizedEventInput,
  ): Promise<NormalizedEventDocument> {
    validateNormalizedEvent(input);
    await this.collection().insertOne(input);
    return input;
  }

  public async createMany(
    inputs: readonly CreateNormalizedEventInput[],
  ): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }

    for (const input of inputs) {
      validateNormalizedEvent(input);
    }

    const result = await this.collection().insertMany([...inputs], {
      ordered: false,
    });
    return result.insertedCount;
  }

  public async findByEventId(
    eventId: string,
  ): Promise<NormalizedEventDocument | null> {
    return this.collection().findOne({ event_id: requireNonBlank(eventId, "eventId") });
  }

  public async findByDedupHash(
    dedupHash: string,
  ): Promise<NormalizedEventDocument | null> {
    return this.collection().findOne({ dedup_hash: requireNonBlank(dedupHash, "dedupHash") });
  }

  public async list(
    filters: NormalizedEventListFilters = {},
  ): Promise<MongoPageResult<NormalizedEventDocument>> {
    const { limit, offset } = normalizeMongoPagination(filters);
    const query = buildNormalizedEventFilter(filters);
    const sort: Sort = { time: filters.sortDirection === "asc" ? 1 : -1, event_id: 1 };

    const items = await this.collection()
      .find(query)
      .sort(sort)
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    return toMongoPage(items, limit, offset);
  }

  public async listByEventIds(
    eventIds: readonly string[],
  ): Promise<readonly NormalizedEventDocument[]> {
    if (eventIds.length === 0) {
      return [];
    }

    const uniqueEventIds = Array.from(
      new Set(eventIds.map((eventId) => requireNonBlank(eventId, "eventId"))),
    );

    return this.collection()
      .find({ event_id: { $in: uniqueEventIds } })
      .sort({ time: -1, event_id: 1 })
      .toArray();
  }

  public async listByBatchId(
    batchId: string,
    options?: MongoPaginationOptions,
  ): Promise<MongoPageResult<NormalizedEventDocument>> {
    return this.list({ ...options, batchId: requireNonBlank(batchId, "batchId") });
  }

  public async searchMessage(
    query: string,
    options?: MongoPaginationOptions,
  ): Promise<MongoPageResult<NormalizedEventDocument>> {
    const search = requireNonBlank(query, "query");
    const { limit, offset } = normalizeMongoPagination(options);
    const items = await this.collection()
      .find(
        { $text: { $search: search } },
        { projection: { score: { $meta: "textScore" } } },
      )
      .sort({ score: { $meta: "textScore" }, time: -1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    return toMongoPage(items, limit, offset);
  }

  private collection(): Collection<NormalizedEventDocument> {
    return requireMongoDatabase(this.client).collection<NormalizedEventDocument>(
      COLLECTION_NAME,
    );
  }
}

function buildNormalizedEventFilter(
  filters: NormalizedEventListFilters,
): Filter<NormalizedEventDocument> {
  const clauses: Filter<NormalizedEventDocument>[] = [];

  if (filters.orgId !== undefined) {
    clauses.push({
      org_id: requireNonBlank(filters.orgId, "orgId"),
    });
  }

  if (filters.classUid !== undefined) {
    assertNonNegativeInteger(filters.classUid, "classUid");

    clauses.push({
      class_uid: filters.classUid,
    });
  }

  if (filters.categoryUid !== undefined) {
    assertNonNegativeInteger(filters.categoryUid, "categoryUid");

    clauses.push({
      category_uid: filters.categoryUid,
    });
  }

  if (filters.minSeverityId !== undefined) {
    assertNumberRange(filters.minSeverityId, "minSeverityId", 0, 6);

    clauses.push({
      severity_id: {
        $gte: filters.minSeverityId,
      },
    });
  }

  if (filters.srcIp !== undefined) {
    clauses.push({
      "src_endpoint.ip": requireNonBlank(filters.srcIp, "srcIp"),
    });
  }

  if (filters.dstIp !== undefined) {
    clauses.push({
      "dst_endpoint.ip": requireNonBlank(filters.dstIp, "dstIp"),
    });
  }

  if (filters.username !== undefined) {
    clauses.push({
      "actor.user.name": requireNonBlank(filters.username, "username"),
    });
  }

  if (filters.hostname !== undefined) {
    clauses.push({
      "device.hostname": requireNonBlank(filters.hostname, "hostname"),
    });
  }

  if (filters.collectorId !== undefined) {
    clauses.push({
      "ingestion.collector_id": requireNonBlank(
        filters.collectorId,
        "collectorId",
      ),
    });
  }

  if (filters.batchId !== undefined) {
    clauses.push({
      "ingestion.batch_id": requireNonBlank(filters.batchId, "batchId"),
    });
  }

  if (
    filters.from !== undefined &&
    filters.to !== undefined &&
    filters.from > filters.to
  ) {
    throw new Error("from must be earlier than or equal to to");
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    clauses.push({
      time: {
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

function validateNormalizedEvent(input: CreateNormalizedEventInput): void {
  requireNonBlank(input.event_id, "event_id");
  assertNonNegativeInteger(input.class_uid, "class_uid");
  assertNonNegativeInteger(input.category_uid, "category_uid");
  assertNumberRange(input.severity_id, "severity_id", 0, 6);
  requireNonBlank(input.message, "message");
  requireNonBlank(input.metadata.version, "metadata.version");
  requireNonBlank(input.ingestion.batch_id, "ingestion.batch_id");
  requireNonBlank(input.ingestion.collector_id, "ingestion.collector_id");
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
