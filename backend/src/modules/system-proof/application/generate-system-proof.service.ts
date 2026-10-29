import { AI_FEATURE_NAMES } from "../../feature-extraction/index.js";
import { SHA256_DIGEST_PATTERN } from "../../../shared/sha256-digest.js";
import type {
  GenerateSystemProofInput,
  SystemProofDataSource,
  SystemProofReport,
  SystemProofStage,
} from "../domain/system-proof.contracts.js";

export class GenerateSystemProofService {
  public constructor(
    private readonly dataSource: SystemProofDataSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: GenerateSystemProofInput): Promise<SystemProofReport> {
    const orgId = requireNonBlank(input.orgId, "orgId");
    const explicitEventId = optionalNonBlank(input.eventId, "eventId");
    const eventId = explicitEventId ?? await this.dataSource.resolveLatestEventId(orgId);
    const stages: SystemProofStage[] = [];
    const evidence: Record<string, unknown> = {};

    stages.push(stage(
      "event_selection",
      "Evidence event selected",
      eventId !== null,
      eventId === null
        ? "No incident-linked event was available for this organization."
        : `Selected event ${eventId}.`,
      { method: explicitEventId === undefined ? "latest-linked-event" : "explicit" },
    ));

    if (eventId === null) {
      return report(input, orgId, null, stages, evidence, this.now());
    }

    const normalized = await this.dataSource.findNormalizedEvent(eventId);
    const normalizedValid = normalized !== null &&
      normalized.orgId === orgId &&
      normalized.schemaValid !== false;
    stages.push(stage(
      "normalized_event",
      "OCSF event normalized and stored",
      normalizedValid,
      normalized === null
        ? "The selected event is absent from MongoDB normalized events."
        : normalized.orgId !== orgId
          ? "The normalized event does not belong to the configured organization."
          : normalized.schemaValid === false
            ? "The normalized event is marked schema-invalid."
            : "The tenant-scoped normalized OCSF event is present.",
      normalized === null ? {} : {
        batchId: normalized.batchId,
        collectorId: normalized.collectorId,
        classUid: normalized.classUid,
        severityId: normalized.severityId,
        ingestedAt: normalized.ingestedAt.toISOString(),
      },
    ));
    if (normalized !== null) {
      evidence.normalizedEvent = {
        eventId: normalized.eventId,
        batchId: normalized.batchId,
        collectorId: normalized.collectorId,
        classUid: normalized.classUid,
        severityId: normalized.severityId,
        schemaValid: normalized.schemaValid,
        ingestedAt: normalized.ingestedAt.toISOString(),
        pipelineDurationMs: normalized.pipelineDurationMs,
      };
    }

    const archive = normalized === null
      ? null
      : await this.dataSource.findRawArchive(normalized.batchId);
    const archiveValid = archive !== null && normalized !== null &&
      archive.batchId === normalized.batchId &&
      archive.collectorId === normalized.collectorId &&
      (archive.orgId === null || archive.orgId === orgId) &&
      SHA256_DIGEST_PATTERN.test(archive.canonicalUnsignedSha256) &&
      archive.storedEventCount > 0 &&
      (archive.eventCount === null || archive.eventCount === archive.storedEventCount);
    stages.push(stage(
      "verified_archive",
      "Signed collector batch verified and archived",
      archiveValid,
      archive === null
        ? "No verified raw-batch archive was found for the selected event."
        : archiveValid
          ? "The verified collector batch and canonical digest are present."
          : "The archived batch metadata is internally inconsistent.",
      archive === null ? {} : {
        batchId: archive.batchId,
        collectorId: archive.collectorId,
        eventCount: archive.eventCount,
        storedEventCount: archive.storedEventCount,
        canonicalUnsignedSha256: archive.canonicalUnsignedSha256,
        archivedAt: archive.archivedAt.toISOString(),
      },
    ));
    if (archive !== null) {
      evidence.verifiedBatch = {
        batchId: archive.batchId,
        collectorId: archive.collectorId,
        canonicalUnsignedSha256: archive.canonicalUnsignedSha256,
        eventCount: archive.eventCount,
        archivedAt: archive.archivedAt.toISOString(),
      };
    }

    const missingFeatures = normalized === null
      ? [...AI_FEATURE_NAMES]
      : AI_FEATURE_NAMES.filter((name) => !isFiniteNumber(normalized.features[name]));
    stages.push(stage(
      "feature_extraction",
      "AI feature vector extracted",
      missingFeatures.length === 0,
      missingFeatures.length === 0
        ? `All ${AI_FEATURE_NAMES.length} model features are stored and finite.`
        : `Missing or invalid model features: ${missingFeatures.join(", ")}.`,
      { expectedFeatureCount: AI_FEATURE_NAMES.length, missingFeatures },
    ));

    const ai = await this.dataSource.findAiResult(eventId);
    const aiValid = ai !== null && normalized !== null &&
      ai.orgId === orgId &&
      ai.batchId === normalized.batchId &&
      ai.usedFallback === false &&
      ai.inputFeatureCount === AI_FEATURE_NAMES.length &&
      (!ai.isAnomaly || ai.shapFeatureCount > 0) &&
      ai.anomalyScore >= 0 && ai.anomalyScore <= 1;
    stages.push(stage(
      "ai_inference",
      "AI inference persisted",
      aiValid,
      ai === null
        ? "No persisted AI inference exists for this event; fallback or an incomplete pipeline may have occurred."
        : ai.usedFallback
          ? "The stored result is marked as fallback and is not accepted as genuine inference."
          : aiValid
            ? "A contract-valid, non-fallback model result is stored."
            : "The stored AI result failed tenant, batch, feature, or score validation.",
      ai === null ? {} : {
        modelName: ai.modelName,
        modelVersion: ai.modelVersion,
        anomalyScore: ai.anomalyScore,
        confidence: ai.confidence,
        isAnomaly: ai.isAnomaly,
        shapFeatureCount: ai.shapFeatureCount,
        processingTimeMs: ai.processingTimeMs,
      },
    ));
    if (ai !== null) {
      evidence.aiResult = {
        modelName: ai.modelName,
        modelVersion: ai.modelVersion,
        anomalyScore: ai.anomalyScore,
        confidence: ai.confidence,
        isAnomaly: ai.isAnomaly,
        processingTimeMs: ai.processingTimeMs,
        shapFeatureCount: ai.shapFeatureCount,
        createdAt: ai.createdAt.toISOString(),
      };
    }

    const links = await this.dataSource.listIncidentLinks(eventId);
    const uniqueLink = links.length === 1 ? links[0]! : null;
    const incident = uniqueLink === null
      ? null
      : await this.dataSource.findIncident(uniqueLink.incidentId);
    const [alerts, incidentEvents] = incident === null
      ? [[], []] as const
      : await Promise.all([
          this.dataSource.listIncidentAlerts(incident.id),
          this.dataSource.listIncidentEvents(incident.id),
        ]);
    const matchingAlerts = alerts.filter((alert) =>
      alert.matchedEventIds.some((matchedId) => matchedId === eventId));
    stages.push(stage(
      "detection",
      "Rule or AI alert persisted",
      matchingAlerts.length > 0,
      matchingAlerts.length > 0
        ? `${matchingAlerts.length} persisted alert(s) reference the selected event.`
        : "No persisted alert references the selected event.",
      {
        matchingAlertCount: matchingAlerts.length,
        alertTypes: [...new Set(matchingAlerts.map((alert) => alert.type))],
        ruleNames: matchingAlerts.flatMap((alert) => alert.ruleName === null ? [] : [alert.ruleName]),
      },
    ));

    const incidentValid = incident !== null &&
      links.length === 1 &&
      incident.orgId === orgId &&
      incident.alertCount === alerts.length &&
      incident.eventCount === incidentEvents.length &&
      incidentEvents.some((link) => link.eventId === eventId) &&
      incident.riskScore >= 0 && incident.riskScore <= 100;
    stages.push(stage(
      "incident_correlation",
      "Incident correlated and risk scored",
      incidentValid,
      incident === null
        ? `Expected exactly one incident link; found ${links.length}.`
        : incidentValid
          ? "The tenant-scoped incident, evidence counts, and risk score are consistent."
          : "The incident failed tenant, linkage, count, or risk-score validation.",
      incident === null ? { incidentLinkCount: links.length } : {
        incidentId: incident.id,
        status: incident.status,
        severity: incident.severity,
        source: incident.source,
        riskScore: incident.riskScore,
        alertCount: incident.alertCount,
        eventCount: incident.eventCount,
        primaryEntity: incident.primaryEntity,
      },
    ));
    if (incident !== null) {
      evidence.incident = {
        id: incident.id,
        status: incident.status,
        severity: incident.severity,
        riskScore: incident.riskScore,
        source: incident.source,
        alertCount: incident.alertCount,
        eventCount: incident.eventCount,
        primaryEntity: incident.primaryEntity,
        createdAt: incident.createdAt.toISOString(),
      };
      evidence.alerts = matchingAlerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        ruleName: alert.ruleName,
        anomalyScore: alert.anomalyScore,
        severity: alert.severity,
      }));
    }

    const audits = incident === null
      ? []
      : await this.dataSource.listIncidentAudits(incident.id, orgId);
    const creationAudit = audits.find((audit) => audit.action === "incident_create");
    stages.push(stage(
      "immutable_audit",
      "Immutable incident audit recorded",
      creationAudit !== undefined,
      creationAudit === undefined
        ? "No tenant-scoped incident_create audit record was found."
        : "The incident creation audit record is present.",
      creationAudit === undefined ? {} : {
        auditId: creationAudit.id,
        action: creationAudit.action,
        createdAt: creationAudit.createdAt.toISOString(),
      },
    ));

    const notification = incident === null
      ? null
      : await this.dataSource.findNotification(incident.id, orgId);
    const notificationQueued = notification !== null &&
      notification.incidentId === incident?.id &&
      notification.orgId === orgId &&
      notification.status !== "dead_letter";
    stages.push(stage(
      "notification_outbox",
      "Replay-safe notification queued",
      notificationQueued,
      notification === null
        ? "No incident notification outbox record was found."
        : notification.status === "dead_letter"
          ? "The notification is dead-lettered."
          : `The notification is ${notification.status}.`,
      notification === null ? {} : {
        notificationId: notification.id,
        type: notification.type,
        channel: notification.channel,
        status: notification.status,
        attemptCount: notification.attemptCount,
        publishedAt: notification.publishedAt?.toISOString() ?? null,
      },
    ));

    const requirePublished = input.requirePublishedNotification ?? true;
    const marker = notification === null
      ? null
      : await this.dataSource.getPublishedNotificationMarker(notification.id);
    const publicationValid = notification !== null &&
      (requirePublished
        ? notification.status === "published" &&
          notification.publishedAt !== null &&
          marker === notification.id
        : notification.status !== "dead_letter");
    stages.push(stage(
      "redis_publication",
      "Redis notification publication verified",
      publicationValid,
      !requirePublished && notificationQueued
        ? "Publication was not required; the durable outbox record is valid."
        : publicationValid
          ? "The published outbox row and Redis deduplication marker agree."
          : "The notification is not published or its Redis marker is missing.",
      { required: requirePublished, markerMatches: notification !== null && marker === notification.id },
    ));

    const collector = normalized === null
      ? null
      : await this.dataSource.findCollectorStatus(normalized.collectorId);
    const requireHeartbeat = input.requireCollectorHeartbeat ?? true;
    const collectorValid = collector !== null &&
      collector.orgId === orgId &&
      collector.lastHeartbeatAt !== null;
    stages.push(stage(
      "collector_heartbeat",
      "Collector heartbeat recorded",
      requireHeartbeat ? collectorValid : true,
      collectorValid
        ? `Collector status is ${collector.status}.`
        : requireHeartbeat
          ? "No matching tenant-scoped collector heartbeat is stored."
          : "Collector heartbeat was not required for this proof run.",
      collector === null ? { required: requireHeartbeat } : {
        required: requireHeartbeat,
        collectorId: collector.collectorId,
        status: collector.status,
        lastHeartbeatAt: collector.lastHeartbeatAt?.toISOString() ?? null,
        filesProcessed: collector.filesProcessed,
        eventsCollected: collector.eventsCollected,
        errorsCount: collector.errorsCount,
      },
    ));

    if (normalized !== null && incident !== null) {
      evidence.timing = {
        storedPipelineDurationMs: normalized.pipelineDurationMs,
        ingestionToIncidentMs: Math.max(
          0,
          incident.createdAt.getTime() - normalized.ingestedAt.getTime(),
        ),
      };
    }

    return report(input, orgId, eventId, stages, evidence, this.now());
  }
}

function report(
  input: GenerateSystemProofInput,
  orgId: string,
  eventId: string | null,
  stages: readonly SystemProofStage[],
  evidence: Readonly<Record<string, unknown>>,
  generatedAt: Date,
): SystemProofReport {
  return Object.freeze({
    proof: "trivikrama-end-to-end-siem",
    proofVersion: "1.0",
    generatedAt: generatedAt.toISOString(),
    passed: stages.every((item) => item.status === "PASS"),
    eventSelection: input.eventId === undefined ? "latest-linked-event" : "explicit",
    eventId,
    organizationId: orgId,
    stages: Object.freeze([...stages]),
    evidence: Object.freeze({ ...evidence }),
  });
}

function stage(
  id: string,
  label: string,
  passed: boolean,
  summary: string,
  details: Readonly<Record<string, unknown>>,
): SystemProofStage {
  return Object.freeze({ id, label, status: passed ? "PASS" : "FAIL", summary, details });
}

function optionalNonBlank(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonBlank(value, name);
}

function requireNonBlank(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} is required.`);
  return normalized;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
