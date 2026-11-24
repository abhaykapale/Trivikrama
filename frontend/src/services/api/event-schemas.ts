import { z } from "zod";

const date = z.string().datetime({ offset: true });
const finite = z.number().finite();
const record = z.record(z.string(), z.unknown());
const endpoint = z.object({ ip: z.string().optional(), hostname: z.string().optional(), port: z.number().int().optional(), mac: z.string().optional() });
const process = z.object({ name: z.string().optional(), pid: z.number().int().optional(), cmd_line: z.string().optional(), path: z.string().optional() });
export const eventSchema = z.object({
  eventId: z.string().min(1), classUid: z.number().int().nonnegative(), categoryUid: z.number().int().nonnegative(), severityId: z.number().int().min(0).max(6),
  statusId: z.number().int().optional(), duration: finite.nonnegative().optional(), time: date, message: z.string(),
  srcEndpoint: endpoint.optional(), dstEndpoint: endpoint.optional(),
  actor: z.object({ user: z.object({ name: z.string().optional(), uid: z.string().optional(), domain: z.string().optional(), type: z.string().optional() }).optional(), process: process.optional(), session: z.object({ uid: z.string().optional(), type: z.string().optional() }).optional() }).optional(),
  process: process.optional(), query: z.object({ hostname: z.string().optional() }).optional(),
  device: z.object({ hostname: z.string().optional(), ip: z.string().optional(), type: z.string().optional(), os: z.object({ name: z.string().optional(), version: z.string().optional() }).optional() }).optional(),
  metadata: z.object({ version: z.string(), product: record.optional(), log_level: z.string().optional() }), enrichments: record.optional(), features: record.optional(),
  ingestion: z.object({ batchId: z.string(), collectorId: z.string(), ingestedAt: date, pipelineDurationMs: finite.nonnegative().optional() }),
});
export const eventSearchSchema = z.object({ data: z.array(eventSchema), pagination: z.object({ page: z.number().int().positive(), limit: z.number().int().positive().max(200), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), hasNext: z.boolean(), hasPrev: z.boolean() }), window: z.object({ from: date, to: date }) });
export const eventDetailSchema = eventSchema.extend({ aiAnalysis: z.object({ modelName: z.string(), modelVersion: z.string(), anomalyScore: finite.min(0).max(1), isAnomaly: z.boolean(), confidence: finite.min(0).max(1).optional(), threatCategory: z.string().optional(), threatConfidence: finite.min(0).max(1).optional(), shapExplanation: z.object({ baseValue: finite.optional(), features: z.array(z.object({ name: z.string(), value: finite, shapValue: finite })) }).optional(), processingTimeMs: finite.nonnegative().optional(), usedFallback: z.boolean(), createdAt: date }).nullable() });
export type InvestigationEvent = z.infer<typeof eventSchema>;
