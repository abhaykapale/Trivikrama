import { z } from "zod";

const optionalIsoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

const optionalFilter = z.string().trim().min(1).max(255).optional();

const baseEventQueryShape = {
  query: z.string().trim().min(1).max(200).optional(),
  classUid: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  severityId: z.coerce.number().int().min(0).max(6).optional(),
  srcIp: z.string().trim().min(1).max(45).optional(),
  dstIp: z.string().trim().min(1).max(45).optional(),
  username: optionalFilter,
  hostname: optionalFilter,
  collectorId: optionalFilter,
  from: optionalIsoDate,
  to: optionalIsoDate,
  sort: z.enum(["time", "severityId"]).default("time"),
  order: z.enum(["asc", "desc"]).default("desc"),
} as const;

function validDateOrder(
  value: { readonly from?: Date; readonly to?: Date },
  context: z.RefinementCtx,
): void {
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
}

export const searchEventsQuerySchema = z
  .object({
    ...baseEventQueryShape,
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine(validDateOrder);

export const exportEventsQuerySchema = z
  .object({
    ...baseEventQueryShape,
    format: z.enum(["csv", "json"]).default("csv"),
    maxResults: z.coerce.number().int().min(1).max(10_000).default(10_000),
  })
  .superRefine(validDateOrder);

export const eventIdParamsSchema = z.object({
  eventId: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u,
      "eventId contains unsupported characters",
    ),
});
