import { z } from "zod";
import { AUDIT_ACTIONS } from "../domain/audit-query.contracts.js";

const optionalDate = z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional();

export const listAuditLogsQuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().trim().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/u).optional(),
  targetId: z.string().trim().min(1).max(255).optional(),
  ipAddress: z.union([z.ipv4(), z.ipv6()]).optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["createdAt", "action", "actorUsername", "targetType"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
