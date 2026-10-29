export type SystemProofStageStatus = "PASS" | "FAIL";

export interface SystemProofStage {
  readonly id: string;
  readonly label: string;
  readonly status: SystemProofStageStatus;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SystemProofNormalizedEvent {
  readonly eventId: string;
  readonly batchId: string;
  readonly collectorId: string;
  readonly orgId: string | null;
  readonly classUid: number;
  readonly severityId: number;
  readonly schemaValid: boolean | null;
  readonly features: Readonly<Record<string, unknown>>;
  readonly ingestedAt: Date;
  readonly pipelineDurationMs: number | null;
}

export interface SystemProofRawArchive {
  readonly batchId: string;
  readonly collectorId: string;
  readonly orgId: string | null;
  readonly canonicalUnsignedSha256: string;
  readonly eventCount: number | null;
  readonly archivedAt: Date;
  readonly storedEventCount: number;
}

export interface SystemProofAiResult {
  readonly eventId: string;
  readonly batchId: string | null;
  readonly orgId: string | null;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly anomalyScore: number;
  readonly confidence: number | null;
  readonly isAnomaly: boolean;
  readonly usedFallback: boolean;
  readonly processingTimeMs: number | null;
  readonly inputFeatureCount: number;
  readonly shapFeatureCount: number;
  readonly createdAt: Date;
}

export interface SystemProofIncidentLink {
  readonly incidentId: string;
  readonly eventId: string;
  readonly eventTime: Date;
}

export interface SystemProofIncident {
  readonly id: string;
  readonly orgId: string;
  readonly status: string;
  readonly severity: string;
  readonly riskScore: number;
  readonly source: string;
  readonly alertCount: number;
  readonly eventCount: number;
  readonly primaryEntity: string | null;
  readonly createdAt: Date;
}

export interface SystemProofAlert {
  readonly id: string;
  readonly type: "rule" | "ai";
  readonly ruleName: string | null;
  readonly anomalyScore: number | null;
  readonly severity: string;
  readonly matchedEventIds: readonly unknown[];
}

export interface SystemProofAudit {
  readonly id: string;
  readonly action: string;
  readonly targetId: string | null;
  readonly orgId: string;
  readonly createdAt: Date;
}

export interface SystemProofNotification {
  readonly id: string;
  readonly incidentId: string;
  readonly orgId: string;
  readonly type: string;
  readonly channel: string;
  readonly status: "pending" | "published" | "dead_letter";
  readonly attemptCount: number;
  readonly publishedAt: Date | null;
}

export interface SystemProofCollectorStatus {
  readonly collectorId: string;
  readonly orgId: string;
  readonly status: "online" | "degraded" | "offline";
  readonly lastHeartbeatAt: Date | null;
  readonly filesProcessed: number;
  readonly eventsCollected: number;
  readonly errorsCount: number;
}

export interface SystemProofDataSource {
  resolveLatestEventId(orgId: string): Promise<string | null>;
  findNormalizedEvent(eventId: string): Promise<SystemProofNormalizedEvent | null>;
  findRawArchive(batchId: string): Promise<SystemProofRawArchive | null>;
  findAiResult(eventId: string): Promise<SystemProofAiResult | null>;
  listIncidentLinks(eventId: string): Promise<readonly SystemProofIncidentLink[]>;
  findIncident(incidentId: string): Promise<SystemProofIncident | null>;
  listIncidentAlerts(incidentId: string): Promise<readonly SystemProofAlert[]>;
  listIncidentEvents(incidentId: string): Promise<readonly SystemProofIncidentLink[]>;
  listIncidentAudits(incidentId: string, orgId: string): Promise<readonly SystemProofAudit[]>;
  findNotification(incidentId: string, orgId: string): Promise<SystemProofNotification | null>;
  findCollectorStatus(collectorId: string): Promise<SystemProofCollectorStatus | null>;
  getPublishedNotificationMarker(notificationId: string): Promise<string | null>;
}

export interface GenerateSystemProofInput {
  readonly orgId: string;
  readonly eventId?: string;
  readonly requirePublishedNotification?: boolean;
  readonly requireCollectorHeartbeat?: boolean;
}

export interface SystemProofReport {
  readonly proof: "trivikrama-end-to-end-siem";
  readonly proofVersion: "1.0";
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly eventSelection: "explicit" | "latest-linked-event";
  readonly eventId: string | null;
  readonly organizationId: string;
  readonly stages: readonly SystemProofStage[];
  readonly evidence: Readonly<Record<string, unknown>>;
}
