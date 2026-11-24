import { apiClient, normalizeApiError } from "./client";
import { eventDetailSchema, eventSearchSchema } from "./event-schemas";
import { eventParameters, type EventQuery } from "@/utils/event-query";

export async function searchEvents(query: EventQuery, signal: AbortSignal) {
  try { const response = await apiClient.get<unknown>("/events/search", { params: eventParameters(query), signal, headers: { "Cache-Control": "no-store" } }); return eventSearchSchema.parse(response.data); } catch (error: unknown) { throw normalizeApiError(error); }
}
export async function getEventDetail(id: string, signal: AbortSignal) {
  try { const response = await apiClient.get<unknown>(`/events/${encodeURIComponent(id)}`, { signal, headers: { "Cache-Control": "no-store" } }); return eventDetailSchema.parse(response.data); } catch (error: unknown) { throw normalizeApiError(error); }
}
export async function exportEvents(query: EventQuery, window: { from: string; to: string }, signal: AbortSignal): Promise<Blob> {
  try { const response = await apiClient.get<Blob>("/events/export", { params: { ...query.filters, ...window, sort: query.sort, order: query.order, format: "csv", maxResults: 10000 }, responseType: "blob", signal, headers: { "Cache-Control": "no-store" } }); return response.data; } catch (error: unknown) { throw normalizeApiError(error); }
}
