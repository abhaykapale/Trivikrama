import type { Collection, Filter, Sort } from "mongodb";

import {
  removeUndefined,
  toMongoInt,
  type MongoInsertDocument,
} from "./mongo-document.helpers.js";
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

type MutableMongoFilter = Record<string, unknown>;

export class MongoRawEventArchiveRepository implements IRawEventArchiveRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(
    input: CreateRawEventArchiveInput,
  ): Promise<RawEventArchiveDocument> {
    validateRawArchive(input);
    await this.collection().insertOne(
      toMongoRawEventArchiveDocument(input) as never,
    );
    return input;
  }

  public async findByBatchId(
    batchId: string,
  ): Promise<RawEventArchiveDocument | null> {
    return this.collection().findOne({
      batch_id: requireNonBlank(batchId, "batchId"),
    });
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
    return requireMongoDatabase(
      this.client,
    ).collection<RawEventArchiveDocument>(COLLECTION_NAME);
  }
}

function buildRawArchiveFilter(
  filters: RawEventArchiveListFilters,
): Filter<RawEventArchiveDocument> {
  const query: MutableMongoFilter = {};

  if (filters.orgId !== undefined) {
    query.org_id = requireNonBlank(filters.orgId, "orgId");
  }

  if (filters.collectorId !== undefined) {
    query.collector_id = requireNonBlank(filters.collectorId, "collectorId");
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    const archivedAt: Record<string, Date> = {};

    if (filters.from !== undefined) {
      archivedAt.$gte = filters.from;
    }

    if (filters.to !== undefined) {
      archivedAt.$lte = filters.to;
    }

    query.archived_at = archivedAt;
  }

  return query as Filter<RawEventArchiveDocument>;
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


function toMongoRawEventArchiveDocument(
  input: CreateRawEventArchiveInput,
): MongoInsertDocument {
  return removeUndefined({
    ...input,
    event_count:
      input.event_count === undefined
        ? undefined
        : toMongoInt(input.event_count, "event_count"),
    file_size_bytes:
      input.file_size_bytes === undefined
        ? undefined
        : toMongoInt(input.file_size_bytes, "file_size_bytes"),
  });
}
