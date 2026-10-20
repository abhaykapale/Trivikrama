import type {
  INormalizedEventRepository,
  NormalizedEventDocument,
} from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
  IIncidentEvidenceQueryRepository,
  IncidentNormalizedEventView,
  ListIncidentEventsQuery,
  ListIncidentEventsResult,
} from "../domain/incident-evidence.contracts.js";
import type { IIncidentQueryRepository } from "../domain/incident-query.contracts.js";
import { pagination } from "./list-incident-alerts.use-case.js";

export class ListIncidentEventsUseCase {
  public constructor(
    private readonly incidentQueries: Pick<IIncidentQueryRepository, "findById">,
    private readonly evidenceQueries: Pick<
      IIncidentEvidenceQueryRepository,
      "listEventLinks"
    >,
    private readonly normalizedEvents: Pick<
      INormalizedEventRepository,
      "listByEventIds"
    >,
  ) {}

  public async execute(
    input: ListIncidentEventsQuery,
  ): Promise<ListIncidentEventsResult | null> {
    const incident = await this.incidentQueries.findById(input);
    if (incident === null) return null;

    const page = await this.evidenceQueries.listEventLinks(input);
    const eventIds = page.items.map((link) => link.eventId);
    const documents =
      eventIds.length === 0
        ? []
        : await this.normalizedEvents.listByEventIds(eventIds);
    const safeDocuments = new Map(
      documents.flatMap((document) =>
        document.org_id === input.orgId
          ? ([[document.event_id, document]] as const)
          : [],
      ),
    );

    return {
      data: page.items.flatMap((link) => {
        const document = safeDocuments.get(link.eventId);
        return document === undefined ? [] : [toEventView(document)];
      }),
      pagination: pagination(input.page, input.limit, page.total),
    };
  }
}

function toEventView(
  document: NormalizedEventDocument,
): IncidentNormalizedEventView {
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
    ...(document.actor === undefined ? {} : { actor: document.actor }),
    ...(document.process === undefined
      ? {}
      : { process: document.process as unknown as Record<string, unknown> }),
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
        : {
            pipelineDurationMs: document.ingestion.pipeline_duration_ms,
          }),
    },
  };
}
