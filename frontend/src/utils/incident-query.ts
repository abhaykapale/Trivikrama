import {
  INCIDENT_SORT_FIELDS,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  INCIDENT_TIME_RANGES,
  type IncidentQueueQuery,
  type IncidentSortField,
  type IncidentSource,
  type IncidentStatus,
  type IncidentTimeRange,
  type SortOrder,
} from "@/types/incidents";
import { SEVERITIES, type Severity } from "@/types/dashboard";

const DEFAULT_QUERY: IncidentQueueQuery = {
  page: 1,
  timeRange: "24h",
  sort: "createdAt",
  order: "desc",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RANGE_MILLISECONDS: Readonly<Record<Exclude<IncidentTimeRange, "all">, number>> = {
  "1h": 60 * 60 * 1_000,
  "4h": 4 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

interface SearchParameters {
  get(name: string): string | null;
}

export function parseIncidentQueueQuery(parameters: SearchParameters): IncidentQueueQuery {
  const pageValue = Number(parameters.get("page"));
  const search = parameters.get("search")?.trim().slice(0, 200);
  const assignedTo = parameters.get("assignedTo")?.trim();

  return {
    page: Number.isInteger(pageValue) && pageValue >= 1 && pageValue <= 1_000_000 ? pageValue : DEFAULT_QUERY.page,
    ...optionalEnum("status", parameters, INCIDENT_STATUSES, "status"),
    ...optionalEnum("severity", parameters, SEVERITIES, "severity"),
    ...optionalEnum("source", parameters, INCIDENT_SOURCES, "source"),
    ...(assignedTo && UUID_PATTERN.test(assignedTo) ? { assignedTo } : {}),
    ...(search ? { search } : {}),
    timeRange: readEnum(parameters.get("range"), INCIDENT_TIME_RANGES, DEFAULT_QUERY.timeRange),
    sort: readEnum(parameters.get("sort"), INCIDENT_SORT_FIELDS, DEFAULT_QUERY.sort),
    order: readEnum(parameters.get("order"), ["asc", "desc"] as const, DEFAULT_QUERY.order),
  } as IncidentQueueQuery;
}

export function toIncidentApiParameters(query: IncidentQueueQuery, nowMs = Date.now()): Readonly<Record<string, string | number>> {
  return {
    page: query.page,
    limit: 25,
    sort: query.sort,
    order: query.order,
    ...(query.status ? { status: query.status } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.timeRange === "all" ? {} : { from: new Date(nowMs - RANGE_MILLISECONDS[query.timeRange]).toISOString() }),
  };
}

export function countIncidentFilters(query: IncidentQueueQuery): number {
  return Number(Boolean(query.status)) + Number(Boolean(query.severity)) + Number(Boolean(query.source)) + Number(Boolean(query.assignedTo)) + Number(Boolean(query.search)) + Number(query.timeRange !== "24h");
}

export function buildIncidentQueueSearch(query: IncidentQueueQuery): string {
  const parameters = new URLSearchParams();
  if (query.page > 1) parameters.set("page", String(query.page));
  if (query.status) parameters.set("status", query.status);
  if (query.severity) parameters.set("severity", query.severity);
  if (query.source) parameters.set("source", query.source);
  if (query.assignedTo) parameters.set("assignedTo", query.assignedTo);
  if (query.search) parameters.set("search", query.search);
  if (query.timeRange !== "24h") parameters.set("range", query.timeRange);
  if (query.sort !== "createdAt") parameters.set("sort", query.sort);
  if (query.order !== "desc") parameters.set("order", query.order);
  return parameters.toString();
}

function readEnum<const TValues extends readonly string[]>(value: string | null, values: TValues, fallback: TValues[number]): TValues[number] {
  return value && values.includes(value) ? value as TValues[number] : fallback;
}

function optionalEnum<
  const TKey extends "status" | "severity" | "source",
  const TValues extends readonly string[],
>(parameter: string, parameters: SearchParameters, values: TValues, key: TKey): Partial<Record<TKey, IncidentStatus | Severity | IncidentSource>> {
  const value = parameters.get(parameter);
  return value && values.includes(value) ? { [key]: value } as Partial<Record<TKey, IncidentStatus | Severity | IncidentSource>> : {};
}

export type { IncidentSortField, IncidentSource, IncidentStatus, IncidentTimeRange, Severity, SortOrder };
