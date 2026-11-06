import { z } from "zod";
import { DASHBOARD_INTERVALS, DASHBOARD_RANGES } from "../domain/dashboard.contracts.js";

export const dashboardRangeQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("24h"),
});

export const dashboardTimelineQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("24h"),
  interval: z.enum(DASHBOARD_INTERVALS).optional(),
});

export const dashboardTopAssetsQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("24h"),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
