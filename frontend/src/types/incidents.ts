import type { Severity } from "./dashboard";

export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export const INCIDENT_SOURCES = ["rule", "ai", "both"] as const;
export const INCIDENT_SORT_FIELDS = ["createdAt", "updatedAt", "riskScore", "severity", "alertCount"] as const;
export const INCIDENT_TIME_RANGES = ["1h", "4h", "24h", "7d", "30d", "all"] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];
export type IncidentSortField = (typeof INCIDENT_SORT_FIELDS)[number];
export type IncidentTimeRange = (typeof INCIDENT_TIME_RANGES)[number];
export type SortOrder = "asc" | "desc";

export interface IncidentQueueItem {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: IncidentStatus;
  readonly severity: Severity;
  readonly riskScore: number;
  readonly source: IncidentSource;
  readonly primaryEntity: string | null;
  readonly entityType: string | null;
  readonly alertCount: number;
  readonly eventCount: number;
  readonly assignedTo: string | null;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncidentQueuePage {
  readonly data: readonly IncidentQueueItem[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
  };
}

export interface IncidentQueueQuery {
  readonly page: number;
  readonly status?: IncidentStatus;
  readonly severity?: Severity;
  readonly source?: IncidentSource;
  readonly assignedTo?: string;
  readonly search?: string;
  readonly timeRange: IncidentTimeRange;
  readonly sort: IncidentSortField;
  readonly order: SortOrder;
}

export interface IncidentPagination {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface IncidentEntity { readonly type: string; readonly value: string; }
export interface IncidentRiskFactor { readonly value: number; readonly weight: number; readonly contribution: number; readonly availability: "observed" | "neutral_default" | "disabled"; readonly source: string; }
export interface IncidentRiskBreakdown { readonly factors?: Readonly<Record<string, IncidentRiskFactor>>; readonly rawScore?: number; readonly finalScore?: number; readonly formula?: string; }

export interface IncidentDetail extends IncidentQueueItem {
  readonly scoreBreakdown: IncidentRiskBreakdown;
  readonly entities: readonly IncidentEntity[];
  readonly killChainStages: readonly string[];
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

export interface IncidentAlert {
  readonly id: string; readonly incidentId: string; readonly alertType: "rule" | "ai";
  readonly ruleId: string | null; readonly ruleName: string | null; readonly matchedCondition: string | null;
  readonly anomalyScore: number | null; readonly confidence: number | null; readonly threatCategory: string | null;
  readonly modelVersion: string | null; readonly shapValues: Readonly<Record<string, unknown>> | null;
  readonly severity: Severity; readonly weight: number; readonly tags: readonly unknown[];
  readonly matchedEventIds: readonly unknown[]; readonly createdAt: string;
}

export interface IncidentAlertPage { readonly data: readonly IncidentAlert[]; readonly pagination: IncidentPagination; }

export interface IncidentEvent {
  readonly eventId: string; readonly classUid: number; readonly categoryUid: number; readonly severityId: number;
  readonly statusId?: number; readonly duration?: number; readonly time: string; readonly message: string;
  readonly srcEndpoint?: Readonly<Record<string, unknown>>; readonly dstEndpoint?: Readonly<Record<string, unknown>>;
  readonly actor?: Readonly<Record<string, unknown>>; readonly process?: Readonly<Record<string, unknown>>;
  readonly device?: Readonly<Record<string, unknown>>; readonly metadata: Readonly<Record<string, unknown>>;
  readonly enrichments?: Readonly<Record<string, unknown>>; readonly features?: Readonly<Record<string, unknown>>;
  readonly ingestion: { readonly batchId: string; readonly collectorId: string; readonly ingestedAt: string; readonly pipelineDurationMs?: number };
}

export interface IncidentEventPage { readonly data: readonly IncidentEvent[]; readonly pagination: IncidentPagination; }

interface TimelineEntryBase { readonly id: string; readonly incidentId: string; readonly timestamp: string; }
export interface IncidentTimelineEvent extends TimelineEntryBase { readonly type: "event"; readonly eventId: string; readonly eventClassUid: number | null; readonly eventSeverity: number | null; readonly eventMessage: string | null; }
export interface IncidentTimelineAlert extends TimelineEntryBase { readonly type: "alert"; readonly alertId: string; readonly alertType: "rule" | "ai"; readonly alertSeverity: Severity; readonly alertTitle: string; readonly anomalyScore: number | null; }
export interface IncidentTimelineAction extends TimelineEntryBase { readonly type: "action"; readonly action: "created" | "status_change" | "assigned" | "note_added" | "updated"; readonly actorId: string; readonly actorName: string; readonly previousValue: string | null; readonly newValue: string | null; readonly noteContent: string | null; }
export type IncidentTimelineEntry = IncidentTimelineEvent | IncidentTimelineAlert | IncidentTimelineAction;
export interface IncidentTimelinePage { readonly data: readonly IncidentTimelineEntry[]; readonly pagination: IncidentPagination; }

export interface IncidentContext {
  readonly previousIncidents: readonly Pick<IncidentQueueItem, "id" | "title" | "severity" | "status" | "createdAt">[];
  readonly assets: readonly { readonly name: string; readonly assetType: string; readonly ipAddress: string | null; readonly criticality: number; readonly owner: string | null; readonly department: string | null; readonly tags: readonly unknown[] }[];
  readonly entityHistory: Readonly<Record<string, { readonly firstSeenAt: string | null; readonly incidentCount30d: number; readonly alertCount30d: number }>>;
}

export type IncidentDetailTab = "overview" | "alerts" | "events" | "ai" | "timeline";

export const INCIDENT_RESOLUTIONS = ["tp_mitigated", "tp_accepted", "fp_rule_tuning", "fp_ai_noise", "fp_known", "duplicate", "informational"] as const;
export type IncidentResolution = (typeof INCIDENT_RESOLUTIONS)[number];

export interface IncidentStatusMutationResult { readonly id: string; readonly status: IncidentStatus; readonly updatedAt: string; }
export interface IncidentAssignmentMutationResult { readonly id: string; readonly assignedTo: string | null; readonly updatedAt: string; }
export interface IncidentNoteMutationResult { readonly id: string; readonly incidentId: string; readonly authorId: string; readonly authorName: string; readonly content: string; readonly createdAt: string; }
export interface IncidentResolutionMutationResult { readonly id: string; readonly status: "resolved"; readonly resolution: IncidentResolution; readonly resolvedAt: string; readonly updatedAt: string; }
