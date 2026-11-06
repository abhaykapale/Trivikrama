import type { Collection, Filter } from "mongodb";

import type { MongoDbClient } from "../../../database/mongodb/client.js";
import type { NormalizedEventDocument } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import { requireMongoDatabase, requireNonBlank } from "../../../database/repositories/mongodb/mongo-repository.types.js";
import type { DetectionEvent } from "../domain/rule-engine.contracts.js";
import type {
  IRuleDryRunEventRepository,
  RuleDryRunEvent,
  RuleDryRunEventQuery,
} from "../domain/rule-operational.contracts.js";

const COLLECTION = "normalized_events";

export class MongoRuleDryRunEventRepository implements IRuleDryRunEventRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async listForRule(input: RuleDryRunEventQuery): Promise<readonly RuleDryRunEvent[]> {
    validateInput(input);
    const filter: Filter<NormalizedEventDocument> = {
      org_id: requireNonBlank(input.orgId, "orgId"),
      class_uid: input.classUid,
      ...(input.categoryUid === undefined ? {} : { category_uid: input.categoryUid }),
      time: { $gte: input.from, $lte: input.to },
    };
    const documents = await this.events()
      .find(filter, { projection: SAFE_PROJECTION })
      .sort({ time: 1, event_id: 1 })
      .limit(input.limit)
      .toArray();

    return documents.map((document) => ({
      event: toDetectionEvent(document),
      time: document.time,
      message: document.message,
    }));
  }

  private events(): Collection<NormalizedEventDocument> {
    return requireMongoDatabase(this.client).collection<NormalizedEventDocument>(COLLECTION);
  }
}

const SAFE_PROJECTION = {
  _id: 0,
  event_id: 1,
  class_uid: 1,
  category_uid: 1,
  severity_id: 1,
  status_id: 1,
  duration: 1,
  time: 1,
  message: 1,
  src_endpoint: 1,
  dst_endpoint: 1,
  actor: 1,
  process: 1,
  query: 1,
  device: 1,
  metadata: 1,
  enrichments: 1,
  features: 1,
  ingestion: 1,
} as const;

function toDetectionEvent(document: NormalizedEventDocument): DetectionEvent {
  return {
    event_id: document.event_id,
    class_uid: document.class_uid,
    category_uid: document.category_uid,
    severity_id: document.severity_id,
    time: document.time,
    message: document.message,
    ...(document.status_id === undefined ? {} : { status_id: document.status_id }),
    ...(document.duration === undefined ? {} : { duration: document.duration }),
    ...(document.src_endpoint === undefined ? {} : { src_endpoint: document.src_endpoint }),
    ...(document.dst_endpoint === undefined ? {} : { dst_endpoint: document.dst_endpoint }),
    ...(document.actor === undefined ? {} : { actor: document.actor }),
    ...(document.process === undefined ? {} : { process: document.process }),
    ...(document.query === undefined ? {} : { query: document.query }),
    ...(document.device === undefined ? {} : { device: document.device }),
    metadata: document.metadata,
    ...(document.enrichments === undefined ? {} : { enrichments: document.enrichments }),
    ...(document.features === undefined ? {} : { features: document.features }),
    ingestion: document.ingestion,
  };
}

function validateInput(input: RuleDryRunEventQuery): void {
  if (!Number.isSafeInteger(input.classUid) || input.classUid < 0) {
    throw new Error("classUid must be a non-negative integer");
  }
  if (input.categoryUid !== undefined && (!Number.isSafeInteger(input.categoryUid) || input.categoryUid < 0)) {
    throw new Error("categoryUid must be a non-negative integer");
  }
  if (input.from.getTime() > input.to.getTime()) {
    throw new Error("from must be earlier than or equal to to");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new Error("limit must be an integer between 1 and 1000");
  }
}
