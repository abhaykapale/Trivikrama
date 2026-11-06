import type { Collection, Filter, Sort } from "mongodb";

import type { MongoDbClient } from "../../../database/mongodb/client.js";
import type { AiResultDocument } from "../../../database/repositories/mongodb/ai-result.repository.js";
import type { NormalizedEventDocument } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import {
  assertNonNegativeInteger,
  assertNumberRange,
  requireMongoDatabase,
  requireNonBlank,
} from "../../../database/repositories/mongodb/mongo-repository.types.js";
import type {
  EventAiAnalysisView,
  EventDetailView,
  EventInvestigationView,
  EventRepositoryPage,
  EventRepositorySearchQuery,
  GetEventDetailInput,
  IEventInvestigationRepository,
} from "../domain/event-query.contracts.js";

const NORMALIZED_EVENTS_COLLECTION = "normalized_events";
const AI_RESULTS_COLLECTION = "ai_results";

type MutableMongoFilter = Record<string, unknown>;

export class MongoEventInvestigationRepository
  implements IEventInvestigationRepository
{
  public constructor(private readonly client: MongoDbClient) {}

  public async search(
    input: EventRepositorySearchQuery,
  ): Promise<EventRepositoryPage> {
    validateSearch(input);
    const filter = buildFilter(input);
    const sort = buildSort(input);
    const collection = this.events();

    const [documents, total] = await Promise.all([
      collection
        .find(filter, { projection: SAFE_EVENT_PROJECTION })
        .sort(sort)
        .skip(input.offset)
        .limit(input.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      items: documents.map(toEventView),
      total,
    };
  }

  public async findById(
    input: GetEventDetailInput,
  ): Promise<EventDetailView | null> {
    const orgId = requireNonBlank(input.orgId, "orgId");
    const eventId = requireNonBlank(input.eventId, "eventId");
    const event = await this.events().findOne(
      { event_id: eventId, org_id: orgId },
      { projection: SAFE_EVENT_PROJECTION },
    );

    if (event === null) return null;

    const analysis = await this.aiResults()
      .find({ event_id: eventId, org_id: orgId }, { projection: SAFE_AI_PROJECTION })
      .sort({ created_at: -1, model_name: 1, model_version: 1 })
      .limit(1)
      .next();

    return {
      ...toEventView(event),
      aiAnalysis: analysis === null ? null : toAiAnalysisView(analysis),
    };
  }

  private events(): Collection<NormalizedEventDocument> {
    return requireMongoDatabase(this.client).collection<NormalizedEventDocument>(
      NORMALIZED_EVENTS_COLLECTION,
    );
  }

  private aiResults(): Collection<AiResultDocument> {
    return requireMongoDatabase(this.client).collection<AiResultDocument>(
      AI_RESULTS_COLLECTION,
    );
  }
}

const SAFE_EVENT_PROJECTION = {
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

const SAFE_AI_PROJECTION = {
  _id: 0,
  event_id: 1,
  model_name: 1,
  model_version: 1,
  anomaly_score: 1,
  is_anomaly: 1,
  confidence: 1,
  threat_category: 1,
  threat_confidence: 1,
  shap_explanation: 1,
  processing_time_ms: 1,
  used_fallback: 1,
  created_at: 1,
} as const;

function buildFilter(
  input: EventRepositorySearchQuery,
): Filter<NormalizedEventDocument> {
  const filter: MutableMongoFilter = {
    org_id: requireNonBlank(input.orgId, "orgId"),
    time: { $gte: input.from, $lte: input.to },
  };

  if (input.query !== undefined) {
    filter.$text = { $search: requireNonBlank(input.query, "query") };
  }
  if (input.classUid !== undefined) filter.class_uid = input.classUid;
  if (input.severityId !== undefined) filter.severity_id = input.severityId;
  if (input.srcIp !== undefined) filter["src_endpoint.ip"] = input.srcIp;
  if (input.dstIp !== undefined) filter["dst_endpoint.ip"] = input.dstIp;
  if (input.username !== undefined) {
    filter["actor.user.name"] = input.username;
  }
  if (input.hostname !== undefined) {
    filter["device.hostname"] = input.hostname;
  }
  if (input.collectorId !== undefined) {
    filter["ingestion.collector_id"] = input.collectorId;
  }

  return filter as Filter<NormalizedEventDocument>;
}

function buildSort(input: EventRepositorySearchQuery): Sort {
  const direction = input.order === "asc" ? 1 : -1;
  return input.sort === "severityId"
    ? { severity_id: direction, time: direction, event_id: direction }
    : { time: direction, event_id: direction };
}

function validateSearch(input: EventRepositorySearchQuery): void {
  requireNonBlank(input.orgId, "orgId");
  if (input.query !== undefined) requireNonBlank(input.query, "query");
  if (input.classUid !== undefined) {
    assertNonNegativeInteger(input.classUid, "classUid");
  }
  if (input.severityId !== undefined) {
    assertNumberRange(input.severityId, "severityId", 0, 6);
  }
  if (!Number.isInteger(input.offset) || input.offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new Error("limit must be an integer between 1 and 200");
  }
  if (input.from.getTime() > input.to.getTime()) {
    throw new Error("from must be earlier than or equal to to");
  }
}

function toEventView(document: NormalizedEventDocument): EventInvestigationView {
  return {
    eventId: document.event_id,
    classUid: document.class_uid,
    categoryUid: document.category_uid,
    severityId: document.severity_id,
    ...(document.status_id === undefined ? {} : { statusId: document.status_id }),
    ...(document.duration === undefined ? {} : { duration: document.duration }),
    time: document.time,
    message: document.message,
    ...(document.src_endpoint === undefined
      ? {}
      : { srcEndpoint: document.src_endpoint }),
    ...(document.dst_endpoint === undefined
      ? {}
      : { dstEndpoint: document.dst_endpoint }),
    ...(document.actor === undefined
      ? {}
      : {
          actor: {
            ...(document.actor.user === undefined
              ? {}
              : { user: document.actor.user }),
            ...(document.actor.process === undefined
              ? {}
              : { process: document.actor.process }),
            ...(document.actor.session === undefined
              ? {}
              : { session: document.actor.session }),
          },
        }),
    ...(document.process === undefined ? {} : { process: document.process }),
    ...(document.query === undefined ? {} : { query: document.query }),
    ...(document.device === undefined ? {} : { device: document.device }),
    metadata: document.metadata,
    ...(document.enrichments === undefined
      ? {}
      : { enrichments: document.enrichments }),
    ...(document.features === undefined ? {} : { features: document.features }),
    ingestion: {
      batchId: document.ingestion.batch_id,
      collectorId: document.ingestion.collector_id,
      ingestedAt: document.ingestion.ingested_at,
      ...(document.ingestion.pipeline_duration_ms === undefined
        ? {}
        : { pipelineDurationMs: document.ingestion.pipeline_duration_ms }),
    },
  };
}

function toAiAnalysisView(document: AiResultDocument): EventAiAnalysisView {
  return {
    modelName: document.model_name,
    modelVersion: document.model_version,
    anomalyScore: document.anomaly_score,
    isAnomaly: document.is_anomaly,
    ...(document.confidence === undefined
      ? {}
      : { confidence: document.confidence }),
    ...(document.threat_category === undefined
      ? {}
      : { threatCategory: document.threat_category }),
    ...(document.threat_confidence === undefined
      ? {}
      : { threatConfidence: document.threat_confidence }),
    ...(document.shap_explanation === undefined
      ? {}
      : {
          shapExplanation: {
            ...(document.shap_explanation.base_value === undefined
              ? {}
              : { baseValue: document.shap_explanation.base_value }),
            features: (document.shap_explanation.features ?? []).map(
              (feature) => ({
                name: feature.name,
                value: feature.value,
                shapValue: feature.shap_value,
              }),
            ),
          },
        }),
    ...(document.processing_time_ms === undefined
      ? {}
      : { processingTimeMs: document.processing_time_ms }),
    usedFallback: document.used_fallback === true,
    createdAt: document.created_at,
  };
}
