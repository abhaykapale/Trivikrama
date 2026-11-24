import type {
  DashboardRange,
  DashboardSourceBreakdown,
  DashboardSummary,
  DashboardTimeline,
  DashboardTopAssets,
  RecentIncidentPage,
} from "@/types/dashboard";
import { apiClient, normalizeApiError } from "./client";
import {
  dashboardSourceBreakdownSchema,
  dashboardSummarySchema,
  dashboardTimelineSchema,
  dashboardTopAssetsSchema,
  recentIncidentPageSchema,
} from "./dashboard-schemas";

const PRIVATE_REQUEST = { "Cache-Control": "no-store" } as const;

export async function getDashboardSummary(range: DashboardRange, signal: AbortSignal): Promise<DashboardSummary> {
  return getAndParse("/dashboard/summary", { range }, signal, dashboardSummarySchema);
}

export async function getDashboardTimeline(range: DashboardRange, signal: AbortSignal): Promise<DashboardTimeline> {
  return getAndParse("/dashboard/timeline", { range }, signal, dashboardTimelineSchema);
}

export async function getDashboardTopAssets(range: DashboardRange, signal: AbortSignal): Promise<DashboardTopAssets> {
  return getAndParse("/dashboard/top-assets", { range, limit: 8 }, signal, dashboardTopAssetsSchema);
}

export async function getDashboardSourceBreakdown(range: DashboardRange, signal: AbortSignal): Promise<DashboardSourceBreakdown> {
  return getAndParse("/dashboard/source-breakdown", { range }, signal, dashboardSourceBreakdownSchema);
}

export async function getRecentIncidents(signal: AbortSignal): Promise<RecentIncidentPage> {
  return getAndParse(
    "/incidents",
    { page: 1, limit: 8, sort: "createdAt", order: "desc" },
    signal,
    recentIncidentPageSchema,
  );
}

async function getAndParse<T>(
  path: string,
  params: Readonly<Record<string, string | number>>,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
): Promise<T> {
  try {
    const response = await apiClient.get<unknown>(path, { params, signal, headers: PRIVATE_REQUEST });
    return schema.parse(response.data);
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}
