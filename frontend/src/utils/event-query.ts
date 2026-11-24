export const EVENT_FILTERS = ["query", "srcIp", "dstIp", "username", "hostname", "collectorId", "classUid", "severityId", "from", "to"] as const;
export type EventFilters = Partial<Record<(typeof EVENT_FILTERS)[number], string>>;
export interface EventQuery { readonly filters: EventFilters; readonly page: number; readonly sort: "time" | "severityId"; readonly order: "asc" | "desc"; readonly eventId?: string; }
export function validEventId(value: string): boolean { return value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u.test(value); }
export function parseEventQuery(params: URLSearchParams): EventQuery {
  const filters: EventFilters = {};
  for (const key of EVENT_FILTERS) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (key === "classUid" || key === "severityId") { if (!/^\d+$/u.test(value) || Number(value) > (key === "severityId" ? 6 : 2147483647)) continue; }
    if (key === "from" || key === "to") { if (!Number.isFinite(Date.parse(value))) continue; }
    const maximum = key === "query" ? 200 : key === "srcIp" || key === "dstIp" ? 45 : 255;
    filters[key] = value.slice(0, maximum);
  }
  const page = Number(params.get("page"));
  const eventId = params.get("eventId");
  return { filters, page: Number.isInteger(page) && page >= 1 && page <= 1000000 ? page : 1, sort: params.get("sort") === "severityId" ? "severityId" : "time", order: params.get("order") === "asc" ? "asc" : "desc", ...(eventId && validEventId(eventId) ? { eventId } : {}) };
}
export function eventParameters(query: EventQuery): Record<string, string | number> { return { ...query.filters, page: query.page, limit: 50, sort: query.sort, order: query.order }; }
export function eventSearchString(query: EventQuery): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(query.filters)) if (value) params.set(key, value); if (query.page > 1) params.set("page", String(query.page)); if (query.sort !== "time") params.set("sort", query.sort); if (query.order !== "desc") params.set("order", query.order); if (query.eventId) params.set("eventId", query.eventId); return params.toString(); }
