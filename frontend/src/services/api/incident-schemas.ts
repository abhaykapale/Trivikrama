import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeNumber = z.number().finite().nonnegative();
const optionalDateTime = z.string().refine((value) => Number.isFinite(Date.parse(value))).nullable();
const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const record = z.record(z.string(), z.unknown());
const severity = z.enum(["critical", "high", "medium", "low", "informational"]);
const status = z.enum(["open", "investigating", "resolved", "closed"]);
const source = z.enum(["rule", "ai", "both"]);
const paginationSchema = z.object({ page: z.number().int().positive(), limit: z.number().int().positive().max(100), total: nonNegativeInteger, totalPages: nonNegativeInteger, hasNext: z.boolean(), hasPrev: z.boolean() });
const incidentQueueItemSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1), description: z.string().nullable(), status, severity,
  riskScore: nonNegativeNumber.max(100), source, primaryEntity: z.string().nullable(), entityType: z.string().nullable(),
  alertCount: nonNegativeInteger, eventCount: nonNegativeInteger, assignedTo: z.string().uuid().nullable(),
  firstEventAt: optionalDateTime, lastEventAt: optionalDateTime, createdAt: dateTime, updatedAt: dateTime,
});

export const incidentQueuePageSchema = z.object({
  data: z.array(incidentQueueItemSchema), pagination: paginationSchema,
});

const riskFactorSchema = z.object({ value: z.number().finite().min(0).max(1), weight: z.number().finite().min(0).max(1), contribution: z.number().finite().min(0).max(1), availability: z.enum(["observed", "neutral_default", "disabled"]), source: z.string() });
export const incidentDetailSchema = incidentQueueItemSchema.extend({
  scoreBreakdown: z.object({ factors: z.record(z.string(), riskFactorSchema).optional(), rawScore: z.number().finite().min(0).max(1).optional(), finalScore: nonNegativeNumber.max(100).optional(), formula: z.string().optional() }),
  entities: z.array(z.object({ type: z.string().min(1), value: z.string().min(1).max(255) })), killChainStages: z.array(z.string().min(1)), resolvedAt: optionalDateTime, closedAt: optionalDateTime,
});

export const incidentAlertPageSchema = z.object({
  data: z.array(z.object({ id: z.string().uuid(), incidentId: z.string().uuid(), alertType: z.enum(["rule", "ai"]), ruleId: z.string().uuid().nullable(), ruleName: z.string().nullable(), matchedCondition: z.string().nullable(), anomalyScore: z.number().finite().min(0).max(1).nullable(), confidence: z.number().finite().min(0).max(1).nullable(), threatCategory: z.string().nullable(), modelVersion: z.string().nullable(), shapValues: record.nullable(), severity, weight: z.number().finite().min(0).max(1), tags: z.array(z.unknown()), matchedEventIds: z.array(z.unknown()), createdAt: dateTime })), pagination: paginationSchema,
});

export const incidentEventPageSchema = z.object({
  data: z.array(z.object({ eventId: z.string().min(1), classUid: nonNegativeInteger, categoryUid: nonNegativeInteger, severityId: z.number().int().min(0).max(6), statusId: z.number().int().optional(), duration: nonNegativeNumber.optional(), time: dateTime, message: z.string(), srcEndpoint: record.optional(), dstEndpoint: record.optional(), actor: record.optional(), process: record.optional(), device: record.optional(), metadata: record, enrichments: record.optional(), features: record.optional(), ingestion: z.object({ batchId: z.string().min(1), collectorId: z.string().min(1), ingestedAt: dateTime, pipelineDurationMs: nonNegativeNumber.optional() }) })), pagination: paginationSchema,
});

const timelineBase = { id: z.string().min(1), incidentId: z.string().uuid(), timestamp: dateTime };
export const incidentTimelinePageSchema = z.object({
  data: z.array(z.discriminatedUnion("type", [
    z.object({ ...timelineBase, type: z.literal("event"), eventId: z.string().min(1), eventClassUid: nonNegativeInteger.nullable(), eventSeverity: nonNegativeInteger.nullable(), eventMessage: z.string().nullable() }),
    z.object({ ...timelineBase, type: z.literal("alert"), alertId: z.string().uuid(), alertType: z.enum(["rule", "ai"]), alertSeverity: severity, alertTitle: z.string().min(1), anomalyScore: z.number().finite().nullable() }),
    z.object({ ...timelineBase, type: z.literal("action"), action: z.enum(["created", "status_change", "assigned", "note_added", "updated"]), actorId: z.string().min(1), actorName: z.string().min(1), previousValue: z.string().nullable(), newValue: z.string().nullable(), noteContent: z.string().nullable() }),
  ])), pagination: paginationSchema,
});

export const incidentContextSchema = z.object({
  previousIncidents: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1), severity, status, createdAt: dateTime })).max(50),
  assets: z.array(z.object({ name: z.string().min(1), assetType: z.string().min(1), ipAddress: z.string().nullable(), criticality: z.number().finite().min(0).max(1), owner: z.string().nullable(), department: z.string().nullable(), tags: z.array(z.unknown()) })),
  entityHistory: z.record(z.string(), z.object({ firstSeenAt: optionalDateTime, incidentCount30d: nonNegativeInteger, alertCount30d: nonNegativeInteger })),
});

export const incidentStatusMutationSchema = z.object({ id: z.string().uuid(), status, updatedAt: dateTime });
export const incidentAssignmentMutationSchema = z.object({ id: z.string().uuid(), assignedTo: z.string().uuid().nullable(), updatedAt: dateTime });
export const incidentNoteMutationSchema = z.object({ id: z.string().uuid(), incidentId: z.string().uuid(), authorId: z.string().uuid(), authorName: z.string().min(1), content: z.string().min(1).max(10_000), createdAt: dateTime });
export const incidentResolutionMutationSchema = z.object({ id: z.string().uuid(), status: z.literal("resolved"), resolution: z.enum(["tp_mitigated", "tp_accepted", "fp_rule_tuning", "fp_ai_noise", "fp_known", "duplicate", "informational"]), resolvedAt: dateTime, updatedAt: dateTime });
