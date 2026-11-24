import { z } from "zod";

const dateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)));
export const managedUserPageSchema = z.object({
  data: z.array(z.object({ id: z.string().uuid(), username: z.string().min(1), email: z.string().email(), role: z.enum(["admin", "security_engineer", "soc_analyst"]), displayName: z.string().nullable(), isActive: z.boolean(), lastLoginAt: dateTime.nullable(), createdAt: dateTime })),
  pagination: z.object({ page: z.number().int().positive(), limit: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), hasNext: z.boolean(), hasPrev: z.boolean() }),
});
