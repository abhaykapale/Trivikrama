import { z } from "zod";
import { MAX_SIGMA_RULE_SOURCE_BYTES } from "../domain/rule-command.contracts.js";
import { RULE_DRY_RUN_MAX_EVENTS, RULE_DRY_RUN_MAX_RANGE_SECONDS } from "../domain/rule-operational.contracts.js";

export const listRulesQuerySchema = z.object({
  status: z.enum(["active", "disabled", "archived"]).optional(),
  type: z.enum(["match", "count", "sequence"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low", "informational"]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  tag: z.string().trim().min(1).max(200).optional(),
  isBuiltin: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["name", "severity", "status", "createdAt", "updatedAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const ruleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createRuleBodySchema = z
  .object({
    yamlContent: z
      .string()
      .min(1)
      .max(MAX_SIGMA_RULE_SOURCE_BYTES)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= MAX_SIGMA_RULE_SOURCE_BYTES,
        `yamlContent must not exceed ${MAX_SIGMA_RULE_SOURCE_BYTES} UTF-8 bytes`,
      ),
  })
  .strict();

export const updateRuleBodySchema = createRuleBodySchema;

export const emptyRuleCommandBodySchema = z.object({}).strict();

const dryRunTimeRangeSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,4}[mhd]$/u, "timeRange must use <positive integer><m|h|d>")
  .default("24h")
  .transform((value) => {
    const amount = Number(value.slice(0, -1));
    const unit = value.at(-1);
    return amount * (unit === "m" ? 60 : unit === "h" ? 3_600 : 86_400);
  })
  .refine(
    (seconds) => seconds <= RULE_DRY_RUN_MAX_RANGE_SECONDS,
    `timeRange must not exceed ${RULE_DRY_RUN_MAX_RANGE_SECONDS} seconds`,
  );

export const dryRunRuleBodySchema = z
  .object({
    timeRange: dryRunTimeRangeSchema,
    limit: z.number().int().min(1).max(RULE_DRY_RUN_MAX_EVENTS).default(1_000),
  })
  .strict()
  .transform((value) => ({
    timeRangeSeconds: value.timeRange,
    limit: value.limit,
  }));

export const exportRulesQuerySchema = z
  .object({
    status: z.enum(["active", "disabled", "archived"]).default("active"),
  })
  .strict();
