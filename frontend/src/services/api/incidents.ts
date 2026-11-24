import type { IncidentAlertPage, IncidentAssignmentMutationResult, IncidentContext, IncidentDetail, IncidentEventPage, IncidentNoteMutationResult, IncidentQueuePage, IncidentQueueQuery, IncidentResolution, IncidentResolutionMutationResult, IncidentStatus, IncidentStatusMutationResult, IncidentTimelinePage } from "@/types/incidents";
import { toIncidentApiParameters } from "@/utils/incident-query";
import { apiClient, normalizeApiError } from "./client";
import { incidentAlertPageSchema, incidentAssignmentMutationSchema, incidentContextSchema, incidentDetailSchema, incidentEventPageSchema, incidentNoteMutationSchema, incidentQueuePageSchema, incidentResolutionMutationSchema, incidentStatusMutationSchema, incidentTimelinePageSchema } from "./incident-schemas";

export async function getIncidentQueue(query: IncidentQueueQuery, signal: AbortSignal): Promise<IncidentQueuePage> {
  try {
    const response = await apiClient.get<unknown>("/incidents", {
      params: toIncidentApiParameters(query),
      signal,
      headers: { "Cache-Control": "no-store" },
    });
    return incidentQueuePageSchema.parse(response.data);
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}

const PRIVATE_HEADERS = { "Cache-Control": "no-store" } as const;
export function getIncidentDetail(id: string, signal: AbortSignal): Promise<IncidentDetail> { return getAndParse(`/incidents/${encodeURIComponent(id)}`, {}, signal, incidentDetailSchema); }
export function getIncidentAlerts(id: string, page: number, signal: AbortSignal): Promise<IncidentAlertPage> { return getAndParse(`/incidents/${encodeURIComponent(id)}/alerts`, { page, limit: 50 }, signal, incidentAlertPageSchema); }
export function getIncidentEvents(id: string, page: number, signal: AbortSignal): Promise<IncidentEventPage> { return getAndParse(`/incidents/${encodeURIComponent(id)}/events`, { page, limit: 25 }, signal, incidentEventPageSchema); }
export function getIncidentTimeline(id: string, page: number, signal: AbortSignal): Promise<IncidentTimelinePage> { return getAndParse(`/incidents/${encodeURIComponent(id)}/timeline`, { page, limit: 50 }, signal, incidentTimelinePageSchema); }
export function getIncidentContext(id: string, signal: AbortSignal): Promise<IncidentContext> { return getAndParse(`/incidents/${encodeURIComponent(id)}/context`, {}, signal, incidentContextSchema); }

export function transitionIncidentStatus(id: string, status: IncidentStatus): Promise<IncidentStatusMutationResult> { return mutateAndParse("put", `/incidents/${encodeURIComponent(id)}/status`, { status }, incidentStatusMutationSchema); }
export function assignIncident(id: string, assignedTo: string | null): Promise<IncidentAssignmentMutationResult> { return mutateAndParse("put", `/incidents/${encodeURIComponent(id)}/assign`, { assignedTo }, incidentAssignmentMutationSchema); }
export function addIncidentNote(id: string, content: string): Promise<IncidentNoteMutationResult> { return mutateAndParse("post", `/incidents/${encodeURIComponent(id)}/notes`, { content }, incidentNoteMutationSchema); }
export function resolveIncident(id: string, resolution: IncidentResolution, note?: string): Promise<IncidentResolutionMutationResult> { return mutateAndParse("put", `/incidents/${encodeURIComponent(id)}/resolve`, { resolution, ...(note ? { note } : {}) }, incidentResolutionMutationSchema); }

async function getAndParse<T>(path: string, params: Readonly<Record<string, string | number>>, signal: AbortSignal, schema: { parse(value: unknown): T }): Promise<T> {
  try { const response = await apiClient.get<unknown>(path, { params, signal, headers: PRIVATE_HEADERS }); return schema.parse(response.data); }
  catch (error: unknown) { throw normalizeApiError(error); }
}

async function mutateAndParse<T>(method: "post" | "put", path: string, body: unknown, schema: { parse(value: unknown): T }): Promise<T> {
  try { const response = await apiClient.request<unknown>({ method, url: path, data: body, headers: PRIVATE_HEADERS }); return schema.parse(response.data); }
  catch (error: unknown) { throw normalizeApiError(error); }
}
