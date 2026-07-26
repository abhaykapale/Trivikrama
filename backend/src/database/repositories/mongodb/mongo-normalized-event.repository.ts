import type { Collection, Filter, Sort } from "mongodb";

import {
  removeUndefined,
  toMongoDouble,
  toMongoInt,
  type MongoInsertDocument,
} from "./mongo-document.helpers.js";
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

type MutableMongoFilter = Record<string, unknown>;

export class MongoNormalizedEventRepository implements INormalizedEventRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async create(
    input: CreateNormalizedEventInput,
  ): Promise<NormalizedEventDocument> {
    validateNormalizedEvent(input);
    await this.collection().insertOne(
      toMongoNormalizedEventDocument(input) as never,
    );
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

    const result = await this.collection().insertMany(
      inputs.map((input) => toMongoNormalizedEventDocument(input)) as never,
      {
        ordered: false,
      },
    );
    return result.insertedCount;
  }

  public async findByEventId(
    eventId: string,
  ): Promise<NormalizedEventDocument | null> {
    return this.collection().findOne({
      event_id: requireNonBlank(eventId, "eventId"),
    });
  }

  public async findByDedupHash(
    dedupHash: string,
  ): Promise<NormalizedEventDocument | null> {
    return this.collection().findOne({
      dedup_hash: requireNonBlank(dedupHash, "dedupHash"),
    });
  }

  public async list(
    filters: NormalizedEventListFilters = {},
  ): Promise<MongoPageResult<NormalizedEventDocument>> {
    const { limit, offset } = normalizeMongoPagination(filters);
    const query = buildNormalizedEventFilter(filters);
    const sort: Sort = {
      time: filters.sortDirection === "asc" ? 1 : -1,
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
    return this.list({
      ...options,
      batchId: requireNonBlank(batchId, "batchId"),
    });
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
    return requireMongoDatabase(
      this.client,
    ).collection<NormalizedEventDocument>(COLLECTION_NAME);
  }
}

function buildNormalizedEventFilter(
  filters: NormalizedEventListFilters,
): Filter<NormalizedEventDocument> {
  const query: MutableMongoFilter = {};
  // const query: Filter<NormalizedEventDocument> = {};

  if (filters.orgId !== undefined) {
    query.org_id = requireNonBlank(filters.orgId, "orgId");
  }

  if (filters.classUid !== undefined) {
    assertNonNegativeInteger(filters.classUid, "classUid");
    query.class_uid = filters.classUid;
  }

  if (filters.categoryUid !== undefined) {
    assertNonNegativeInteger(filters.categoryUid, "categoryUid");
    query.category_uid = filters.categoryUid;
  }

  if (filters.minSeverityId !== undefined) {
    assertNumberRange(filters.minSeverityId, "minSeverityId", 0, 6);
    query.severity_id = { $gte: filters.minSeverityId };
  }

  if (filters.srcIp !== undefined) {
    query["src_endpoint.ip"] = requireNonBlank(filters.srcIp, "srcIp");
  }

  if (filters.dstIp !== undefined) {
    query["dst_endpoint.ip"] = requireNonBlank(filters.dstIp, "dstIp");
  }

  if (filters.username !== undefined) {
    query["actor.user.name"] = requireNonBlank(filters.username, "username");
  }

  if (filters.hostname !== undefined) {
    query["device.hostname"] = requireNonBlank(filters.hostname, "hostname");
  }

  if (filters.collectorId !== undefined) {
    query["ingestion.collector_id"] = requireNonBlank(
      filters.collectorId,
      "collectorId",
    );
  }

  if (filters.batchId !== undefined) {
    query["ingestion.batch_id"] = requireNonBlank(filters.batchId, "batchId");
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    const time: Record<string, Date> = {};

    if (filters.from !== undefined) {
      time.$gte = filters.from;
    }

    if (filters.to !== undefined) {
      time.$lte = filters.to;
    }

    query.time = time;
  }

  return query as Filter<NormalizedEventDocument>;
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
function toMongoNormalizedEventDocument(
  input: CreateNormalizedEventInput,
): MongoInsertDocument {
  return removeUndefined({
    ...input,
    class_uid: toMongoInt(input.class_uid, "class_uid"),
    category_uid: toMongoInt(input.category_uid, "category_uid"),
    severity_id: toMongoInt(input.severity_id, "severity_id"),
    src_endpoint:
      input.src_endpoint === undefined
        ? undefined
        : toMongoEndpoint(input.src_endpoint, "src_endpoint"),
    dst_endpoint:
      input.dst_endpoint === undefined
        ? undefined
        : toMongoEndpoint(input.dst_endpoint, "dst_endpoint"),
    actor: input.actor === undefined ? undefined : toMongoActor(input.actor),
    enrichments:
      input.enrichments === undefined
        ? undefined
        : toMongoEnrichments(input.enrichments),
    ingestion: {
      ...input.ingestion,
      pipeline_duration_ms:
        input.ingestion.pipeline_duration_ms === undefined
          ? undefined
          : toMongoInt(
              input.ingestion.pipeline_duration_ms,
              "ingestion.pipeline_duration_ms",
            ),
    },
  });
}

function toMongoEndpoint(
  endpoint: NonNullable<CreateNormalizedEventInput["src_endpoint"]>,
  fieldName: string,
): Record<string, unknown> {
  return removeUndefined({
    ...endpoint,
    port:
      endpoint.port === undefined
        ? undefined
        : toMongoInt(endpoint.port, `${fieldName}.port`),
  });
}

function toMongoActor(
  actor: NonNullable<CreateNormalizedEventInput["actor"]>,
): Record<string, unknown> {
  return removeUndefined({
    ...actor,
    process:
      actor.process === undefined
        ? undefined
        : {
            ...actor.process,
            pid:
              actor.process.pid === undefined
                ? undefined
                : toMongoInt(actor.process.pid, "actor.process.pid"),
          },
  });
}

function toMongoEnrichments(
  enrichments: Record<string, unknown>,
): Record<string, unknown> {
  return removeUndefined({
    ...enrichments,
    asset_criticality:
      typeof enrichments.asset_criticality === "number"
        ? toMongoDouble(
            enrichments.asset_criticality,
            "enrichments.asset_criticality",
          )
        : enrichments.asset_criticality,
    geo_src: toMongoGeo(enrichments.geo_src, "enrichments.geo_src"),
    geo_dst: toMongoGeo(enrichments.geo_dst, "enrichments.geo_dst"),
  });
}

function toMongoGeo(value: unknown, fieldName: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const geo = value as Record<string, unknown>;

  return removeUndefined({
    ...geo,
    latitude:
      typeof geo.latitude === "number"
        ? toMongoDouble(geo.latitude, `${fieldName}.latitude`)
        : geo.latitude,
    longitude:
      typeof geo.longitude === "number"
        ? toMongoDouble(geo.longitude, `${fieldName}.longitude`)
        : geo.longitude,
  });
}
