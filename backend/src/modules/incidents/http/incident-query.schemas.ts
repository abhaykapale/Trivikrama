import { z } from "zod";

const commaSeparatedEnum = <
  const TValues extends readonly [string, ...string[]],
>(
  values: TValues,
) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.split(",").map((entry) => entry.trim()))
    .pipe(z.array(z.enum(values)).min(1));

const optionalIsoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

export const listIncidentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: commaSeparatedEnum([
      "open",
      "investigating",
      "resolved",
      "closed",
    ]).optional(),
    severity: commaSeparatedEnum([
      "critical",
      "high",
      "medium",
      "low",
      "informational",
    ]).optional(),
    source: commaSeparatedEnum(["rule", "ai", "both"]).optional(),
    assignedTo: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(200).optional(),
    from: optionalIsoDate,
    to: optionalIsoDate,
    sort: z
      .enum(["createdAt", "riskScore", "severity", "alertCount", "updatedAt"])
      .default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((value, context) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      value.from.getTime() > value.to.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be earlier than or equal to to",
      });
    }
  });

export const incidentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const incidentTimelineQuerySchema = z
  .object({
    type: z.enum(["event", "alert", "action"]).optional(),
    from: optionalIsoDate,
    to: optionalIsoDate,
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, context) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      value.from.getTime() > value.to.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be earlier than or equal to to",
      });
    }
  });

export const incidentAlertsQuerySchema = z.object({
  type: z.enum(["rule", "ai"]).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const incidentEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
