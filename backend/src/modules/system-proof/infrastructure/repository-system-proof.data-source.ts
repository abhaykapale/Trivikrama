import type { Redis } from "ioredis";

import type { MongoRepositories } from "../../../database/repositories/mongodb/mongo-repository.factory.js";
import type { PostgresRepositories } from "../../../database/repositories/postgres-repository.factory.js";
import type { SystemProofDataSource } from "../domain/system-proof.contracts.js";

export interface RepositorySystemProofDataSourceDependencies {
  readonly postgres: PostgresRepositories;
  readonly mongo: MongoRepositories;
  readonly redis: Pick<Redis, "get">;
  readonly findLatestLinkedEventId: (orgId: string) => Promise<string | null>;
}

export class RepositorySystemProofDataSource implements SystemProofDataSource {
  public constructor(
    private readonly dependencies: RepositorySystemProofDataSourceDependencies,
  ) {}

  public resolveLatestEventId(orgId: string): Promise<string | null> {
    return this.dependencies.findLatestLinkedEventId(orgId);
  }

  public async findNormalizedEvent(eventId: string) {
    const event = await this.dependencies.mongo.normalizedEvents.findByEventId(eventId);
    if (event === null) return null;
    return {
      eventId: event.event_id,
      batchId: event.ingestion.batch_id,
      collectorId: event.ingestion.collector_id,
      orgId: event.org_id ?? null,
      classUid: event.class_uid,
      severityId: event.severity_id,
      schemaValid: event.schema_valid ?? null,
      features: event.features ?? {},
      ingestedAt: event.ingestion.ingested_at,
      pipelineDurationMs: event.ingestion.pipeline_duration_ms ?? null,
    };
  }

  public async findRawArchive(batchId: string) {
    const archive = await this.dependencies.mongo.rawEventArchive.findByBatchId(batchId);
    if (archive === null) return null;
    return {
      batchId: archive.batch_id,
      collectorId: archive.collector_id,
      orgId: archive.org_id ?? null,
      canonicalUnsignedSha256: archive.canonical_unsigned_sha256,
      eventCount: archive.event_count ?? null,
      archivedAt: archive.archived_at,
      storedEventCount: archive.events.length,
    };
  }

  public async findAiResult(eventId: string) {
    const result = await this.dependencies.mongo.aiResults.findLatestByEventId(eventId);
    if (result === null) return null;
    return {
      eventId: result.event_id,
      batchId: result.batch_id ?? null,
      orgId: result.org_id ?? null,
      modelName: result.model_name,
      modelVersion: result.model_version,
      anomalyScore: result.anomaly_score,
      confidence: result.confidence ?? null,
      isAnomaly: result.is_anomaly,
      usedFallback: result.used_fallback ?? false,
      processingTimeMs: result.processing_time_ms ?? null,
      inputFeatureCount: Object.keys(result.input_features ?? {}).length,
      shapFeatureCount: result.shap_explanation?.features?.length ?? 0,
      createdAt: result.created_at,
    };
  }

  public async listIncidentLinks(eventId: string) {
    const page = await this.dependencies.postgres.incidentEvents.list({
      eventId,
      offset: 0,
      limit: 2,
    });
    return page.items.map(mapLink);
  }

  public async findIncident(incidentId: string) {
    const incident = await this.dependencies.postgres.incidents.findById(incidentId);
    if (incident === null) return null;
    return {
      id: incident.id,
      orgId: incident.orgId,
      status: incident.status,
      severity: incident.severity,
      riskScore: incident.riskScore,
      source: incident.source,
      alertCount: incident.alertCount,
      eventCount: incident.eventCount,
      primaryEntity: incident.primaryEntity,
      createdAt: incident.createdAt,
    };
  }

  public async listIncidentAlerts(incidentId: string) {
    const alerts = [];
    let offset = 0;
    while (true) {
      const page = await this.dependencies.postgres.alerts.listByIncident(incidentId, {
        offset,
        limit: 100,
      });
      alerts.push(...page.items);
      if (!page.hasMore) break;
      offset += page.limit;
      if (offset > 500) throw new Error("Incident alert evidence exceeded the supported incident cap.");
    }
    return alerts.map((alert) => ({
      id: alert.id,
      type: alert.alertType,
      ruleName: alert.ruleName,
      anomalyScore: alert.anomalyScore,
      severity: alert.severity,
      matchedEventIds: alert.matchedEventIds,
    }));
  }

  public async listIncidentEvents(incidentId: string) {
    const links = [];
    let offset = 0;
    while (true) {
      const page = await this.dependencies.postgres.incidentEvents.listByIncident(
        incidentId,
        { offset, limit: 100 },
      );
      links.push(...page.items);
      if (!page.hasMore) break;
      offset += page.limit;
      if (offset > 10_000) throw new Error("Incident event evidence exceeded the proof safety bound.");
    }
    return links.map(mapLink);
  }

  public async listIncidentAudits(incidentId: string, orgId: string) {
    const audits = [];
    let offset = 0;
    while (true) {
      const page = await this.dependencies.postgres.audit.list({
        orgId,
        targetType: "incident",
        targetId: incidentId,
        offset,
        limit: 100,
      });
      audits.push(...page.items);
      if (!page.hasMore || page.items.some((audit) => audit.action === "incident_create")) break;
      offset += page.limit;
      if (offset > 1_000) throw new Error("Incident audit evidence exceeded the proof safety bound.");
    }
    return audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      targetId: audit.targetId,
      orgId: audit.orgId,
      createdAt: audit.createdAt,
    }));
  }

  public async findNotification(incidentId: string, orgId: string) {
    const notification = await this.dependencies.postgres.incidentNotificationOutbox
      .findLatestByIncident(incidentId, orgId);
    if (notification === null) return null;
    return {
      id: notification.id,
      incidentId: notification.incidentId,
      orgId: notification.orgId,
      type: notification.eventType,
      channel: notification.channel,
      status: notification.status,
      attemptCount: notification.attemptCount,
      publishedAt: notification.publishedAt,
    };
  }

  public async findCollectorStatus(collectorId: string) {
    const collector = await this.dependencies.postgres.collectorStatus
      .findByCollectorId(collectorId);
    if (collector === null) return null;
    return {
      collectorId: collector.collectorId,
      orgId: collector.orgId,
      status: collector.status,
      lastHeartbeatAt: collector.lastHeartbeatAt,
      filesProcessed: collector.filesProcessed,
      eventsCollected: collector.eventsCollected,
      errorsCount: collector.errorsCount,
    };
  }

  public getPublishedNotificationMarker(notificationId: string): Promise<string | null> {
    return this.dependencies.redis.get(
      `incident-notification:published:v1:${notificationId}`,
    );
  }
}

function mapLink(link: {
  readonly incidentId: string;
  readonly eventId: string;
  readonly eventTime: Date;
}) {
  return {
    incidentId: link.incidentId,
    eventId: link.eventId,
    eventTime: link.eventTime,
  };
}
