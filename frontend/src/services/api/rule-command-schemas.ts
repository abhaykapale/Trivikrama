import { z } from "zod";
const severity = z.enum(["critical", "high", "medium", "low", "informational"]);
export const validationSchema = z.object({ valid: z.literal(true), sigmaId: z.string(), name: z.string(), type: z.enum(["match", "count"]), severity, compiledHash: z.string() });
export const createdRuleSchema = z.object({ id: z.string().uuid(), sigmaId: z.string(), name: z.string(), status: z.literal("active"), type: z.enum(["match", "count"]), severity, version: z.number().int().positive(), createdAt: z.string().datetime({ offset: true }), reloadSignaled: z.boolean() });
export const dryRunSchema = z.object({ ruleId: z.string().uuid(), sigmaId: z.string(), ruleName: z.string(), totalEvaluated: z.number().int().nonnegative(), matches: z.number().int().nonnegative(), matchedEventIds: z.array(z.string()), executionTimeMs: z.number().finite().nonnegative(), sampleMatches: z.array(z.object({ eventId: z.string(), time: z.string().datetime({ offset: true }), message: z.string(), matchedCondition: z.string() })).max(10) });
export function yamlByteLength(value: string): number { return new TextEncoder().encode(value).length; }
