import type { Collection, Filter, Sort } from "mongodb";

import type { MongoDbClient } from "../../mongodb/client.js";
import {
  assertNonNegativeInteger,
  normalizeMongoPagination,
  requireMongoDatabase,
  requireNonBlank,
  type MongoPageResult,
  type MongoPaginationOptions,
} from "./mongo-repository.types.js";
import type {
  CreateRawEventArchiveInput,
  IRawEventArchiveRepository,
  RawEventArchiveDocument,
  RawEventArchiveListFilters,
} from "./raw-event-archive.repository.js";

const COLLECTION_NAME = "raw_events_archive";

export class MongoRawEventArchiveRepository implements IRawEventArchiveRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(
    input: CreateRawEventArchiveInput,
  ): Promise<RawEventArchiveDocument> {
    validateRawArchive(input);
    await this.collection().insertOne(input);
    return input;
  }

  public async findByBatchId(
    batchId: string,
  ): Promise<RawEventArchiveDocument | null> {
    return this.collection().findOne({ batch_id: requireNonBlank(batchId, "batchId") });
  }

  public async list(
    filters: RawEventArchiveListFilters = {},
  ): Promise<MongoPageResult<RawEventArchiveDocument>> {
    const { limit, offset } = normalizeMongoPagination(filters);
    const query = buildRawArchiveFilter(filters);
    const sort: Sort = {
      archived_at: filters.sortDirection === "asc" ? 1 : -1,
      batch_id: 1,
    };

    const items = await this.collection()
      .find(query)
      .sort(sort)
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    return toMongoPage(items, limit, offset);
  }

  public async listByCollectorId(
    collectorId: string,
    options?: MongoPaginationOptions,
  ): Promise<MongoPageResult<RawEventArchiveDocument>> {
    return this.list({
      ...options,
      collectorId: requireNonBlank(collectorId, "collectorId"),
    });
  }

  private collection(): Collection<RawEventArchiveDocument> {
    return requireMongoDatabase(this.client).collection<RawEventArchiveDocument>(
      COLLECTION_NAME,
    );
  }
}

function buildRawArchiveFilter(
  filters: RawEventArchiveListFilters,
): Filter<RawEventArchiveDocument> {
  const clauses: Filter<RawEventArchiveDocument>[] = [];

  if (filters.orgId !== undefined) {
    clauses.push({
      org_id: requireNonBlank(filters.orgId, "orgId"),
    });
  }

  if (filters.collectorId !== undefined) {
    clauses.push({
      collector_id: requireNonBlank(filters.collectorId, "collectorId"),
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
      archived_at: {
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

function validateRawArchive(input: CreateRawEventArchiveInput): void {
  requireNonBlank(input.batch_id, "batch_id");
  requireNonBlank(input.collector_id, "collector_id");

  if (!Array.isArray(input.events)) {
    throw new Error("events must be an array");
  }

  if (input.event_count !== undefined) {
    assertNonNegativeInteger(input.event_count, "event_count");
  }

  if (input.file_size_bytes !== undefined) {
    assertNonNegativeInteger(input.file_size_bytes, "file_size_bytes");
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
