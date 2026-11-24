"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { useIncidentResource } from "@/hooks/use-incident-resource";
import { exportEvents, getEventDetail, searchEvents } from "@/services/api/events";
import type { InvestigationEvent } from "@/services/api/event-schemas";
import { EVENT_FILTERS, eventSearchString, parseEventQuery, type EventFilters, type EventQuery } from "@/utils/event-query";
import { formatDateTime } from "@/utils/dashboard-formatters";

const LABELS: Record<(typeof EVENT_FILTERS)[number], string> = { query: "Message search", srcIp: "Source IP", dstIp: "Destination IP", username: "Username", hostname: "Hostname", collectorId: "Collector", classUid: "OCSF class", severityId: "Severity", from: "From (UTC)", to: "To (UTC)" };
const SEVERITIES = ["Unknown", "Informational", "Low", "Medium", "High", "Critical", "Fatal"];

export function InvestigationWorkspace() {
  const params = useSearchParams();
  const search = params.toString();
  return <InvestigationSession key={search} query={useMemo(() => parseEventQuery(new URLSearchParams(search)), [search])} />;
}

function InvestigationSession({ query }: { readonly query: EventQuery }) {
  const router = useRouter();
  const [filters, setFilters] = useState<EventFilters>(query.filters);
  const [expanded, setExpanded] = useState<string | null>(query.eventId ?? null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const results = useIncidentResource(true, eventSearchString(query), (signal) => searchEvents(query, signal));
  useEffect(() => () => exportController.current?.abort(), []);
  function navigate(next: EventQuery) { const search = eventSearchString(next); router.replace(`/investigate${search ? `?${search}` : ""}`, { scroll: false }); }
  useEffect(() => {
    if ((filters.query ?? "") === (query.filters.query ?? "")) return;
    const timer = window.setTimeout(() => navigate({ ...query, filters, page: 1 }), 500);
    return () => window.clearTimeout(timer);
    // Other filters apply only when Search is submitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.query]);
  function pivot(key: "srcIp" | "dstIp" | "username", value: string) { navigate({ ...query, filters: { ...query.filters, [key]: value }, page: 1, eventId: undefined }); }
  async function download() {
    if (!results.data || exporting) return;
    setExporting(true); setExportError(null);
    const controller = new AbortController(); exportController.current = controller;
    try {
      const blob = await exportEvents(query, results.data.window, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "trivikrama-events.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (!controller.signal.aborted) setExportError("CSV export failed. Check your session and backend availability."); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  }
  return <section className="investigation-page">
    <header className="incident-queue-heading"><div><span className="eyebrow">Evidence investigation</span><h1>Event search</h1><p>Search normalized telemetry and inspect persisted detection evidence.</p></div><div className="incident-heading-actions"><button className="secondary-button" disabled={results.loading || results.refreshing} onClick={results.refresh} type="button"><RefreshCw size={14} />Refresh</button><button className="secondary-button" disabled={!results.data || exporting} onClick={() => void download()} type="button"><Download size={14} />{exporting ? "Exporting…" : "Export CSV"}</button></div></header>
    <form className="enterprise-panel event-filter-form" onSubmit={(event) => { event.preventDefault(); navigate({ ...query, filters, page: 1 }); }}>
      {EVENT_FILTERS.map((key) => <label className={`response-field event-filter-${key}`} key={key}><span>{LABELS[key]}</span>{key === "severityId" ? <select value={filters[key] ?? ""} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}><option value="">All severities</option>{SEVERITIES.map((label, index) => <option value={index} key={label}>{label}</option>)}</select> : <input type={key === "from" || key === "to" ? "datetime-local" : key === "classUid" ? "number" : "search"} min={key === "classUid" ? 0 : undefined} max={key === "classUid" ? 2147483647 : undefined} maxLength={key === "query" ? 200 : key === "srcIp" || key === "dstIp" ? 45 : 255} value={key === "from" || key === "to" ? filters[key]?.replace(/Z$/u, "").slice(0, 16) ?? "" : filters[key] ?? ""} onChange={(event) => setFilters({ ...filters, [key]: (key === "from" || key === "to") && event.target.value ? `${event.target.value}:00.000Z` : event.target.value })} />}</label>)}
      <div className="event-filter-actions"><button type="submit" className="primary-button compact"><Search size={13} />Search</button><button type="button" className="secondary-button" onClick={() => navigate({ filters: {}, page: 1, sort: "time", order: "desc" })}>Reset</button><span>Default window: last 24 hours. Export capped at 10,000 events.</span></div>
    </form>
    {exportError ? <p className="mutation-error" role="alert">{exportError}</p> : null}
    {query.eventId ? <EventEvidence key={query.eventId} id={query.eventId} /> : null}
    <section className="enterprise-panel event-results" aria-busy={results.loading || results.refreshing}>
      <div className="panel-header"><div><h2>Normalized events</h2><p>{results.data ? `${results.data.pagination.total.toLocaleString()} results · ${formatDateTime(results.data.window.from)} – ${formatDateTime(results.data.window.to)} UTC window` : "Searching telemetry"}</p></div><label className="event-sort">Sort <select value={`${query.sort}:${query.order}`} onChange={(event) => { const [sort, order] = event.target.value.split(":"); navigate({ ...query, page: 1, sort: sort as EventQuery["sort"], order: order as EventQuery["order"] }); }}><option value="time:desc">Newest first</option><option value="time:asc">Oldest first</option><option value="severityId:desc">Severity descending</option><option value="severityId:asc">Severity ascending</option></select></label></div>
      {results.error ? <div className="incident-inline-error" role="alert"><span>{results.error}{results.data ? " Showing previous results." : ""}</span><button onClick={results.refresh} type="button">Retry</button></div> : null}
      {results.loading && !results.data ? <div className="section-loading" aria-label="Loading events">{Array.from({ length: 6 }, (_, i) => <span className="skeleton-line" key={i} />)}</div> : null}
      {results.data ? <><div className="table-scroll"><table className="data-table event-search-table"><thead><tr><th /><th>Time</th><th>Severity</th><th>Event message</th><th>Source IP</th><th>Destination IP</th><th>User</th><th>Class</th><th>Collector</th></tr></thead><tbody>{results.data.data.map((event) => <Fragment key={event.eventId}><EventRow event={event} expanded={expanded === event.eventId} toggle={() => setExpanded(expanded === event.eventId ? null : event.eventId)} pivot={pivot} />{expanded === event.eventId ? <tr><td colSpan={9}><EventEvidence id={event.eventId} /></td></tr> : null}</Fragment>)}{!results.data.data.length ? <tr><td colSpan={9}><div className="incident-empty"><strong>No events match this search</strong><span>Adjust the filters or time window.</span></div></td></tr> : null}</tbody></table></div><footer className="incident-pagination"><span>50 per page · {results.refreshing ? "Refreshing…" : "Server-paginated results"}</span><div><button disabled={!results.data.pagination.hasPrev} onClick={() => navigate({ ...query, page: query.page - 1 })} type="button" aria-label="Previous page">‹</button><span>Page {results.data.pagination.page} of {Math.max(1, results.data.pagination.totalPages)}</span><button disabled={!results.data.pagination.hasNext} onClick={() => navigate({ ...query, page: query.page + 1 })} type="button" aria-label="Next page">›</button></div></footer></> : null}
    </section>
  </section>;
}

function EventRow({ event, expanded, toggle, pivot }: { readonly event: InvestigationEvent; readonly expanded: boolean; readonly toggle: () => void; readonly pivot: (key: "srcIp" | "dstIp" | "username", value: string) => void }) {
  const user = event.actor?.user?.name;
  return <tr><td><button className="icon-button" type="button" aria-expanded={expanded} aria-label="Expand event evidence" onClick={toggle}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td><td className="timestamp-cell" title={event.time}>{formatDateTime(event.time)}</td><td><span className={`ocsf-severity severity-${event.severityId}`}>{SEVERITIES[event.severityId]}</span></td><td className="event-message-cell"><button className="event-message-button" onClick={toggle} type="button">{event.message || "No message"}</button><code title={event.eventId}>{event.eventId.slice(0, 32)}{event.eventId.length > 32 ? "…" : ""}</code></td><td><Pivot value={event.srcEndpoint?.ip} onClick={(value) => pivot("srcIp", value)} /></td><td><Pivot value={event.dstEndpoint?.ip} onClick={(value) => pivot("dstIp", value)} /></td><td><Pivot value={user} onClick={(value) => pivot("username", value)} /></td><td className="technical-value">{event.classUid}</td><td className="technical-value">{event.ingestion.collectorId}</td></tr>;
}
function Pivot({ value, onClick }: { readonly value?: string; readonly onClick: (value: string) => void }) { return value ? <button type="button" className="event-pivot" title="Filter by this value" onClick={() => onClick(value)}>{value}</button> : <span>—</span>; }
function EventEvidence({ id }: { readonly id: string }) {
  const resource = useIncidentResource(true, id, (signal) => getEventDetail(id, signal));
  if (resource.loading) return <div className="event-evidence">Loading event evidence…</div>;
  if (resource.error) return <div className="incident-inline-error" role="alert"><span>{resource.error}</span><button type="button" onClick={resource.refresh}>Retry</button></div>;
  if (!resource.data) return null;
  const { aiAnalysis, ...event } = resource.data;
  return <section className="event-evidence"><h3>Event evidence <code>{id}</code></h3><div className="event-evidence-grid"><div><h4>Normalized OCSF record</h4><pre>{JSON.stringify(event, null, 2)}</pre></div><div><h4>AI analysis</h4>{aiAnalysis ? <><dl className="event-ai-facts"><dt>Model</dt><dd>{aiAnalysis.modelName} / {aiAnalysis.modelVersion}</dd><dt>Anomaly score</dt><dd>{aiAnalysis.anomalyScore.toFixed(4)}</dd><dt>Classification</dt><dd>{aiAnalysis.usedFallback ? "Fallback result — not model evidence" : aiAnalysis.isAnomaly ? "Anomaly detected" : "Not anomalous"}</dd><dt>Confidence</dt><dd>{aiAnalysis.confidence === undefined ? "Not provided" : `${(aiAnalysis.confidence * 100).toFixed(1)}%`}</dd></dl><h4>SHAP feature contributions</h4>{aiAnalysis.shapExplanation?.features.length ? <table className="data-table"><thead><tr><th>Feature</th><th>Value</th><th>Contribution</th></tr></thead><tbody>{aiAnalysis.shapExplanation.features.map((feature) => <tr key={feature.name}><td>{feature.name}</td><td>{feature.value}</td><td>{feature.shapValue.toFixed(4)}</td></tr>)}</tbody></table> : <p>No SHAP contributions were persisted.</p>}</> : <p>No persisted AI analysis is available.</p>}</div></div></section>;
}
