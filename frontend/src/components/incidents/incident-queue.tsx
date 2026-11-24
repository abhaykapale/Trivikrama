"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useIncidentQueue } from "@/hooks/use-incident-queue";
import { useIncidentRealtime } from "@/hooks/use-incident-realtime";
import type { RealtimeConnectionStatus } from "@/services/websocket/incident-websocket";
import { INCIDENT_SOURCES, INCIDENT_STATUSES, INCIDENT_TIME_RANGES, type IncidentQueueItem, type IncidentQueueQuery, type IncidentSortField } from "@/types/incidents";
import { SEVERITIES, type Severity } from "@/types/dashboard";
import { formatCount, formatDateTime, formatRelativeTime, formatSeverity, formatSource } from "@/utils/dashboard-formatters";
import { buildIncidentQueueSearch, countIncidentFilters, parseIncidentQueueQuery } from "@/utils/incident-query";

const SORT_OPTIONS: readonly { readonly value: IncidentSortField; readonly label: string }[] = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Last updated" },
  { value: "riskScore", label: "Risk score" },
  { value: "severity", label: "Severity" },
  { value: "alertCount", label: "Alert count" },
];

const TIME_RANGE_LABELS: Readonly<Record<(typeof INCIDENT_TIME_RANGES)[number], string>> = {
  "1h": "Last hour",
  "4h": "Last 4 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

export function IncidentQueue() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParameters = useSearchParams();
  const searchString = searchParameters.toString();
  const query = useMemo(() => parseIncidentQueueQuery(new URLSearchParams(searchString)), [searchString]);
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const [previousSearch, setPreviousSearch] = useState(query.search);
  if (previousSearch !== query.search) {
    setPreviousSearch(query.search);
    setSearchInput(query.search ?? "");
  }
  const { data, loading, refreshing, error, lastUpdated, refresh } = useIncidentQueue(query);
  const handleRealtimeNotification = useCallback(() => void refresh(), [refresh]);
  const realtimeStatus = useIncidentRealtime(handleRealtimeNotification);
  const activeFilterCount = countIncidentFilters(query);

  const navigate = useCallback((nextQuery: IncidentQueueQuery) => {
    const nextSearch = buildIncidentQueueSearch(nextQuery);
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<IncidentQueueQuery>, resetPage = true) => {
    navigate({ ...query, ...patch, page: resetPage ? 1 : patch.page ?? query.page });
  }, [navigate, query]);

  useEffect(() => {
    const normalizedInput = searchInput.trim().slice(0, 200);
    if (normalizedInput === (query.search ?? "")) return;
    const timer = window.setTimeout(() => {
      updateQuery({ search: normalizedInput || undefined }, true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query.search, searchInput, updateQuery]);

  const clearFilters = () => {
    setSearchInput("");
    navigate({ page: 1, timeRange: "24h", sort: query.sort, order: query.order });
  };

  return (
    <section className="incident-queue-page">
      <header className="incident-queue-heading">
        <div>
          <span className="eyebrow">Incident management</span>
          <h1>Incident queue</h1>
          <p>Prioritize and investigate tenant-scoped security incidents.</p>
        </div>
        <div className="incident-heading-actions">
          <RealtimeStatus status={realtimeStatus} />
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      <section className="enterprise-panel incident-filter-panel" aria-label="Incident queue controls">
        <div className="incident-primary-controls">
          <label className="incident-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search incidents</span>
            <input
              type="search"
              value={searchInput}
              maxLength={200}
              placeholder="Search incident title or entity"
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput ? <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search"><X size={13} /></button> : null}
          </label>
          <QueueSelect label="Status" value={query.status ?? ""} onChange={(value) => updateQuery({ status: value as IncidentQueueQuery["status"] || undefined })}>
            <option value="">All statuses</option>
            {INCIDENT_STATUSES.map((status) => <option value={status} key={status}>{formatSource(status)}</option>)}
          </QueueSelect>
          <QueueSelect label="Severity" value={query.severity ?? ""} onChange={(value) => updateQuery({ severity: value as Severity || undefined })}>
            <option value="">All severities</option>
            {SEVERITIES.map((severity) => <option value={severity} key={severity}>{formatSeverity(severity)}</option>)}
          </QueueSelect>
          <QueueSelect label="Detection source" value={query.source ?? ""} onChange={(value) => updateQuery({ source: value as IncidentQueueQuery["source"] || undefined })}>
            <option value="">All sources</option>
            {INCIDENT_SOURCES.map((source) => <option value={source} key={source}>{source === "both" ? "Rule + AI" : source.toUpperCase()}</option>)}
          </QueueSelect>
          <QueueSelect label="Assigned to" value={query.assignedTo ?? ""} onChange={(value) => updateQuery({ assignedTo: value || undefined })}>
            <option value="">All assignees</option>
            {user ? <option value={user.id}>My incidents</option> : null}
            {query.assignedTo && query.assignedTo !== user?.id ? <option value={query.assignedTo}>Specific analyst</option> : null}
          </QueueSelect>
          <QueueSelect label="Time range" value={query.timeRange} onChange={(value) => updateQuery({ timeRange: value as IncidentQueueQuery["timeRange"] })}>
            {INCIDENT_TIME_RANGES.map((range) => <option value={range} key={range}>{TIME_RANGE_LABELS[range]}</option>)}
          </QueueSelect>
        </div>
        <div className="incident-secondary-controls">
          <div className="incident-filter-summary">
            <SlidersHorizontal size={13} aria-hidden="true" />
            <span>{activeFilterCount === 0 ? "Default queue view" : `${activeFilterCount} active ${activeFilterCount === 1 ? "filter" : "filters"}`}</span>
            {activeFilterCount > 0 ? <button type="button" onClick={clearFilters}>Clear filters</button> : null}
          </div>
          <div className="incident-sort-controls">
            <label>
              <span>Sort by</span>
              <select value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value as IncidentSortField })}>
                {SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button
              className="sort-order-button"
              type="button"
              onClick={() => updateQuery({ order: query.order === "desc" ? "asc" : "desc" })}
              aria-label={`Sort ${query.order === "desc" ? "ascending" : "descending"}`}
              title={query.order === "desc" ? "Descending" : "Ascending"}
            >
              {query.order === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            </button>
          </div>
        </div>
      </section>

      <section className="enterprise-panel incident-results" aria-labelledby="incident-results-title" aria-busy={loading || refreshing}>
        <div className="panel-header incident-results-header">
          <div>
            <h2 id="incident-results-title">Security incidents</h2>
            <p>{data ? `${formatCount(data.pagination.total)} matching incidents` : "Loading matching incidents"}</p>
          </div>
          <div className="incident-update-meta">
            {refreshing ? <span>Updating…</span> : lastUpdated ? <span>Updated {formatRelativeTime(lastUpdated.toISOString())}</span> : null}
          </div>
        </div>

        {error && !data ? <QueueError message={error} onRetry={() => void refresh(true)} /> : null}
        {loading && !data ? <QueueSkeleton /> : null}
        {data ? <IncidentTable incidents={data.data} currentUserId={user?.id ?? null} query={query} error={error} onRetry={() => void refresh()} onSort={(sort) => updateQuery({ sort, order: query.sort === sort && query.order === "desc" ? "asc" : "desc" })} /> : null}
        {data ? <QueuePagination query={query} pagination={data.pagination} onPage={(page) => updateQuery({ page }, false)} /> : null}
      </section>
    </section>
  );
}

function QueueSelect({ label, value, onChange, children }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="incident-select-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

function IncidentTable({ incidents, currentUserId, query, error, onRetry, onSort }: {
  readonly incidents: readonly IncidentQueueItem[];
  readonly currentUserId: string | null;
  readonly query: IncidentQueueQuery;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onSort: (field: IncidentSortField) => void;
}) {
  return (
    <>
      {error ? <div className="incident-inline-error" role="alert"><TriangleAlert size={14} /><span>{error} Showing the last available result.</span><button type="button" onClick={onRetry}>Retry</button></div> : null}
      <div className="table-scroll incident-table-scroll">
        <table className="data-table incident-queue-table">
          <thead><tr><SortableHeader label="Severity" field="severity" query={query} onSort={onSort} /><th>Incident</th><th>Status</th><th>Primary entity</th><SortableHeader label="Risk" field="riskScore" query={query} onSort={onSort} /><SortableHeader label="Alerts / events" field="alertCount" query={query} onSort={onSort} /><th>Assignee</th><SortableHeader label="Updated" field="updatedAt" query={query} onSort={onSort} /></tr></thead>
          <tbody>
            {incidents.length === 0 ? (
              <tr><td colSpan={8}><div className="incident-empty"><ShieldAlert size={22} /><strong>No matching incidents</strong><span>Adjust the queue filters or search criteria.</span></div></td></tr>
            ) : incidents.map((incident) => (
              <tr key={incident.id}>
                <td><SeverityBadge severity={incident.severity} /></td>
                <td className="incident-title-cell queue-incident-title"><Link href={`/incidents/${incident.id}`}>{incident.title}</Link><span>{incident.source === "both" ? "RULE + AI" : incident.source.toUpperCase()} · {shortIdentifier(incident.id)}</span></td>
                <td><span className={`status-badge ${incident.status}`}>{incident.status}</span></td>
                <td className="entity-detail"><span className="technical-value" title={incident.primaryEntity ?? undefined}>{incident.primaryEntity ?? "—"}</span><small>{incident.entityType ? formatSource(incident.entityType) : "No entity"}</small></td>
                <td><RiskScore value={incident.riskScore} /></td>
                <td className="evidence-count"><strong>{formatCount(incident.alertCount)}</strong><span>/ {formatCount(incident.eventCount)}</span></td>
                <td><Assignee value={incident.assignedTo} currentUserId={currentUserId} /></td>
                <td className="timestamp-cell" title={formatDateTime(incident.updatedAt)}>{formatRelativeTime(incident.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SortableHeader({ label, field, query, onSort }: { readonly label: string; readonly field: IncidentSortField; readonly query: IncidentQueueQuery; readonly onSort: (field: IncidentSortField) => void }) {
  const active = query.sort === field;
  return (
    <th aria-sort={active ? query.order === "asc" ? "ascending" : "descending" : "none"}>
      <button className={active ? "table-sort active" : "table-sort"} type="button" onClick={() => onSort(field)}>
        {label}{active ? query.order === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
      </button>
    </th>
  );
}

function SeverityBadge({ severity }: { readonly severity: Severity }) {
  return <span className={`severity-badge ${severity}`}><i />{formatSeverity(severity)}</span>;
}

function RiskScore({ value }: { readonly value: number }) {
  return <div className="risk-value" aria-label={`Risk score ${Math.round(value)} out of 100`}><span>{Math.round(value)}</span><i><b style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></i></div>;
}

function Assignee({ value, currentUserId }: { readonly value: string | null; readonly currentUserId: string | null }) {
  return value
    ? <span className="assignee-identifier technical-value" title={value}>{value === currentUserId ? "You" : shortIdentifier(value)}</span>
    : <span className="unassigned-label">Unassigned</span>;
}

function QueuePagination({ query, pagination, onPage }: {
  readonly query: IncidentQueueQuery;
  readonly pagination: { readonly page: number; readonly limit: number; readonly total: number; readonly totalPages: number; readonly hasNext: boolean; readonly hasPrev: boolean };
  readonly onPage: (page: number) => void;
}) {
  const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);
  const displayedTotalPages = Math.max(1, pagination.totalPages);

  return (
    <footer className="incident-pagination">
      <span>Showing {formatCount(start)}–{formatCount(end)} of {formatCount(pagination.total)}</span>
      <div>
        <button type="button" disabled={!pagination.hasPrev} onClick={() => onPage(query.page - 1)} aria-label="Previous incident page"><ChevronLeft size={14} /></button>
        <span>Page <strong>{pagination.page}</strong> of {displayedTotalPages}</span>
        <button type="button" disabled={!pagination.hasNext} onClick={() => onPage(query.page + 1)} aria-label="Next incident page"><ChevronRight size={14} /></button>
      </div>
    </footer>
  );
}

function QueueError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return <div className="incident-error-state" role="alert"><TriangleAlert size={22} /><strong>Incident queue unavailable</strong><span>{message}</span><button className="secondary-button" type="button" onClick={onRetry}>Retry request</button></div>;
}

function QueueSkeleton() {
  return <div className="incident-queue-skeleton" aria-label="Loading incident queue"><span className="skeleton-line heading" />{Array.from({ length: 8 }, (_, index) => <span className="skeleton-line" key={index} />)}</div>;
}

function RealtimeStatus({ status }: { readonly status: RealtimeConnectionStatus }) {
  const label = status === "connected" ? "Live updates" : status === "connecting" ? "Connecting" : status === "reconnecting" ? "Reconnecting" : "Updates offline";
  return <span className={`realtime-status incident-realtime ${status}`} title="Incident notification channel"><i />{label}</span>;
}

function shortIdentifier(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
