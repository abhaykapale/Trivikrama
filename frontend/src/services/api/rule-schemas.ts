import { z } from "zod";

const date = z.string().datetime({ offset: true });
const base = z.object({ id: z.string().uuid(), name: z.string().min(1), description: z.string().nullable(), status: z.enum(["active", "disabled", "archived"]), type: z.enum(["match", "count", "sequence"]), severity: z.enum(["critical", "high", "medium", "low", "informational"]), weight: z.number().finite().min(0).max(1), priority: z.number().int(), classUid: z.number().int().nullable(), categoryUid: z.number().int().nullable(), tags: z.array(z.string()), isBuiltin: z.boolean(), version: z.number().int().positive(), createdAt: date, updatedAt: date });
export const rulePageSchema = z.object({ data: z.array(base.extend({ alertsGenerated: z.number().int().nonnegative(), lastTriggeredAt: date.nullable() })), pagination: z.object({ page: z.number().int().positive(), limit: z.number().int().positive().max(100), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), hasNext: z.boolean(), hasPrev: z.boolean() }) });
export const ruleDetailSchema = base.extend({ yamlContent: z.string(), compiledHash: z.string().nullable(), falsePositives: z.array(z.string()), references: z.array(z.string()), createdBy: z.string().nullable(), updatedBy: z.string().nullable() });
export type RuleDetail = z.infer<typeof ruleDetailSchema>;
