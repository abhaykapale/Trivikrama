"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, ArrowLeft, BellRing, Bot, ChevronLeft, ChevronRight, Clock3, Database, ExternalLink, FileClock, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useIncidentRealtime } from "@/hooks/use-incident-realtime";
import { useIncidentResource } from "@/hooks/use-incident-resource";
import { IncidentResponseActions } from "./incident-response-actions";
import { getIncidentAlerts, getIncidentContext, getIncidentDetail, getIncidentEvents, getIncidentTimeline } from "@/services/api/incidents";
import type { IncidentAlert, IncidentAlertPage, IncidentContext, IncidentDetail as IncidentDetailModel, IncidentDetailTab, IncidentEvent, IncidentEventPage, IncidentPagination, IncidentRiskFactor, IncidentTimelineEntry, IncidentTimelinePage } from "@/types/incidents";
import { formatCount, formatDateTime, formatRelativeTime, formatSeverity, formatSource } from "@/utils/dashboard-formatters";

const TABS: readonly { readonly id: IncidentDetailTab; readonly label: string; readonly icon: typeof ShieldAlert }[] = [
  { id: "overview", label: "Overview", icon: ShieldAlert }, { id: "alerts", label: "Alerts", icon: BellRing },
  { id: "events", label: "Events", icon: Database }, { id: "ai", label: "AI analysis", icon: Bot },
  { id: "timeline", label: "Timeline", icon: FileClock },
];

export function IncidentDetail({ incidentId }: { readonly incidentId: string }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<IncidentDetailTab>("overview");
  const [alertPage, setAlertPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [timelinePage, setTimelinePage] = useState(1);
  const detail = useIncidentResource(true, incidentId, (signal) => getIncidentDetail(incidentId, signal));
  const context = useIncidentResource(activeTab === "overview", incidentId, (signal) => getIncidentContext(incidentId, signal));
  const alerts = useIncidentResource(activeTab === "alerts" || activeTab === "ai", `${incidentId}:${alertPage}`, (signal) => getIncidentAlerts(incidentId, alertPage, signal));
  const events = useIncidentResource(activeTab === "events", `${incidentId}:${eventPage}`, (signal) => getIncidentEvents(incidentId, eventPage, signal));
  const timeline = useIncidentResource(activeTab === "timeline", `${incidentId}:${timelinePage}`, (signal) => getIncidentTimeline(incidentId, timelinePage, signal));

  const refreshActive = useCallback(() => {
    detail.refresh();
    if (activeTab === "overview") context.refresh();
    if (activeTab === "alerts" || activeTab === "ai") alerts.refresh();
    if (activeTab === "events") events.refresh();
    if (activeTab === "timeline") timeline.refresh();
  }, [activeTab, alerts, context, detail, events, timeline]);
  const realtimeStatus = useIncidentRealtime(refreshActive);

  if (detail.loading && !detail.data) return <DetailSkeleton />;
  if (detail.error && !detail.data) return <DetailError message={detail.error} onRetry={detail.refresh} />;
  if (!detail.data) return null;

  const incident = detail.data;
  const refreshing = detail.refreshing || (activeTab === "overview" && context.refreshing) || ((activeTab === "alerts" || activeTab === "ai") && alerts.refreshing) || (activeTab === "events" && events.refreshing) || (activeTab === "timeline" && timeline.refreshing);

  return (
    <section className="incident-detail-page">
      <header className="incident-detail-header">
        <div className="incident-detail-navigation"><Link href="/incidents"><ArrowLeft size={14} />Incident queue</Link><span className="technical-value">{shortId(incident.id)}</span></div>
        <div className="incident-detail-title-row">
          <div className="incident-detail-title"><SeverityBadge severity={incident.severity} /><h1>{incident.title}</h1><p>{incident.description ?? "No incident narrative is available."}</p></div>
          <div className="incident-detail-actions"><span className={`realtime-status ${realtimeStatus}`}><i />{realtimeStatus === "connected" ? "Live" : "Updates offline"}</span><button className="secondary-button" type="button" onClick={refreshActive} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spinning" : ""} />Refresh</button></div>
        </div>
        <div className="incident-response-toolbar"><IncidentResponseActions incident={incident} onChanged={refreshActive} /></div>
        <div className="incident-fact-strip">
          <Fact label="Status"><span className={`status-badge ${incident.status}`}>{incident.status}</span></Fact>
          <Fact label="Risk score"><strong className="incident-risk-number">{incident.riskScore.toFixed(1)}</strong><span>/ 100</span></Fact>
          <Fact label="Detection source"><strong>{incident.source === "both" ? "Rule + AI" : incident.source.toUpperCase()}</strong></Fact>
          <Fact label="Assignee"><strong title={incident.assignedTo ?? undefined}>{incident.assignedTo ? incident.assignedTo === user?.id ? "You" : shortId(incident.assignedTo) : "Unassigned"}</strong></Fact>
          <Fact label="Evidence"><strong>{formatCount(incident.alertCount)}</strong><span>alerts · {formatCount(incident.eventCount)} events</span></Fact>
          <Fact label="Last updated"><strong>{formatRelativeTime(incident.updatedAt)}</strong><span>{formatDateTime(incident.updatedAt)}</span></Fact>
        </div>
      </header>

      {detail.error ? <InlineError message={`${detail.error} Showing the last available incident state.`} onRetry={detail.refresh} /> : null}
      <nav className="incident-detail-tabs" aria-label="Incident detail sections">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? "active" : ""} aria-selected={activeTab === id} role="tab" onClick={() => setActiveTab(id)}><Icon size={13} />{label}{id === "alerts" ? <span>{incident.alertCount}</span> : id === "events" ? <span>{incident.eventCount}</span> : null}</button>)}
      </nav>

      <div className="incident-tab-content" role="tabpanel">
        {activeTab === "overview" ? <Overview incident={incident} resource={context} /> : null}
        {activeTab === "alerts" ? <AlertsPanel resource={alerts} page={alertPage} onPage={setAlertPage} /> : null}
        {activeTab === "events" ? <EventsPanel resource={events} page={eventPage} onPage={setEventPage} /> : null}
        {activeTab === "ai" ? <AiPanel resource={alerts} page={alertPage} onPage={setAlertPage} /> : null}
        {activeTab === "timeline" ? <TimelinePanel resource={timeline} page={timelinePage} onPage={setTimelinePage} /> : null}
      </div>
    </section>
  );
}

type Resource<T> = { readonly data: T | null; readonly loading: boolean; readonly refreshing: boolean; readonly error: string | null; readonly refresh: () => void };

function Overview({ incident, resource }: { readonly incident: IncidentDetailModel; readonly resource: Resource<IncidentContext> }) {
  return <div className="incident-overview-grid"><div className="incident-overview-main"><IncidentEvidenceSummary incident={incident} /><RiskBreakdown incident={incident} /></div><ContextPanel resource={resource} incident={incident} /></div>;
}

function IncidentEvidenceSummary({ incident }: { readonly incident: IncidentDetailModel }) {
  return (
    <section className="enterprise-panel incident-summary-panel">
      <PanelHeader title="Incident evidence" description="Correlated entities and attack progression" />
      <div className="incident-summary-grid">
        <Definition label="Primary entity" value={incident.primaryEntity ?? "Not identified"} technical />
        <Definition label="Entity type" value={incident.entityType ? formatSource(incident.entityType) : "Not identified"} />
        <Definition label="First event" value={incident.firstEventAt ? formatDateTime(incident.firstEventAt) : "Not available"} />
        <Definition label="Last event" value={incident.lastEventAt ? formatDateTime(incident.lastEventAt) : "Not available"} />
      </div>
      <div className="incident-subsection"><h3>Correlated entities</h3><div className="entity-chip-list">{incident.entities.length ? incident.entities.map((entity) => <span key={`${entity.type}:${entity.value}`}><small>{formatSource(entity.type)}</small><code>{entity.value}</code></span>) : <EmptyInline text="No correlated entities are stored." />}</div></div>
      <div className="incident-subsection"><h3>Kill-chain stages</h3><div className="kill-chain-list">{incident.killChainStages.length ? incident.killChainStages.map((stage, index) => <span key={stage}><i>{index + 1}</i>{formatSource(stage)}</span>) : <EmptyInline text="No kill-chain progression is stored." />}</div></div>
    </section>
  );
}

function RiskBreakdown({ incident }: { readonly incident: IncidentDetailModel }) {
  const factors = Object.entries(incident.scoreBreakdown.factors ?? {});
  return (
    <section className="enterprise-panel risk-breakdown-panel">
      <PanelHeader title="Risk score breakdown" description="Persisted factors used by the incident scorer" meta={`${incident.riskScore.toFixed(1)} / 100`} />
      <div className="risk-factor-list">
        {factors.length ? factors.map(([name, factor]) => <RiskFactor key={name} name={name} factor={factor} />) : <EmptyState icon={<Activity size={20} />} title="Breakdown unavailable" text="The incident has a composite score but no factor-level breakdown." compact />}
      </div>
      {incident.scoreBreakdown.formula ? <code className="risk-formula">{incident.scoreBreakdown.formula}</code> : null}
    </section>
  );
}

function RiskFactor({ name, factor }: { readonly name: string; readonly factor: IncidentRiskFactor }) {
  return <div className="risk-factor"><div><strong>{formatSource(name)}</strong><span>{factor.availability === "neutral_default" ? "Neutral default" : formatSource(factor.availability)}</span></div><div className="risk-factor-meter"><i><b style={{ width: `${factor.value * 100}%` }} /></i><strong>{Math.round(factor.value * 100)}%</strong></div><small title={factor.source}>{factor.source}</small></div>;
}

function ContextPanel({ resource, incident }: { readonly resource: Resource<IncidentContext>; readonly incident: IncidentDetailModel }) {
  if (resource.loading && !resource.data) return <SectionLoading label="Loading 30-day context" />;
  if (resource.error && !resource.data) return <SectionError message={resource.error} onRetry={resource.refresh} />;
  const context = resource.data;
  if (!context) return null;
  return (
    <aside className="incident-context-column">
      {resource.error ? <InlineError message={resource.error} onRetry={resource.refresh} /> : null}
      <section className="enterprise-panel"><PanelHeader title="Entity history" description="Activity during the previous 30 days" /><div className="context-list">{Object.entries(context.entityHistory).length ? Object.entries(context.entityHistory).map(([entity, history]) => <div className="context-row" key={entity}><code>{entity}</code><span>First seen {history.firstSeenAt ? formatDateTime(history.firstSeenAt) : "unknown"}</span><strong>{history.incidentCount30d} incidents · {history.alertCount30d} alerts</strong></div>) : <EmptyInline text="No earlier entity activity found." />}</div></section>
      <section className="enterprise-panel"><PanelHeader title="Asset context" description="Matched inventory records" /><div className="context-list">{context.assets.length ? context.assets.map((asset) => <div className="context-row" key={`${asset.name}:${asset.ipAddress}`}><strong>{asset.name}</strong><span>{formatSource(asset.assetType)}{asset.ipAddress ? ` · ${asset.ipAddress}` : ""}</span><em>Criticality {Math.round(asset.criticality * 100)}%</em></div>) : <EmptyInline text="No matching assets found." />}</div></section>
      <section className="enterprise-panel"><PanelHeader title="Related incidents" description="Previous incidents sharing an entity" /><div className="context-list">{context.previousIncidents.length ? context.previousIncidents.map((item) => <Link className="related-incident" href={`/incidents/${item.id}`} key={item.id}><SeverityBadge severity={item.severity} /><span><strong>{item.title}</strong><small>{formatDateTime(item.createdAt)} · {formatSource(item.status)}</small></span><ExternalLink size={11} /></Link>) : <EmptyInline text={`No related incidents for ${incident.primaryEntity ?? "these entities"}.`} />}</div></section>
    </aside>
  );
}

function AlertsPanel({ resource, page, onPage }: { readonly resource: Resource<IncidentAlertPage>; readonly page: number; readonly onPage: (page: number) => void }) {
  if (resource.loading && !resource.data) return <SectionLoading label="Loading correlated alerts" />;
  if (resource.error && !resource.data) return <SectionError message={resource.error} onRetry={resource.refresh} />;
  if (!resource.data) return null;
  return <section className="enterprise-panel incident-section-panel"><PanelHeader title="Correlated alerts" description="Rule and AI detections attached to this incident" meta={`${resource.data.pagination.total} total`} />{resource.error ? <InlineError message={resource.error} onRetry={resource.refresh} /> : null}<div className="alert-evidence-list">{resource.data.data.length ? resource.data.data.map((alert) => <AlertRow alert={alert} key={alert.id} />) : <EmptyState icon={<BellRing size={20} />} title="No alerts found" text="No alert evidence is linked to this incident." compact />}</div><Pagination pagination={resource.data.pagination} page={page} onPage={onPage} /></section>;
}

function AlertRow({ alert }: { readonly alert: IncidentAlert }) {
  const title = alert.alertType === "rule" ? alert.ruleName ?? "Rule detection" : alert.threatCategory ?? "AI anomaly";
  return <article className="alert-evidence-row"><div className={`evidence-type-icon ${alert.alertType}`}>{alert.alertType === "ai" ? <Bot size={15} /> : <ShieldAlert size={15} />}</div><div className="alert-evidence-body"><div><SeverityBadge severity={alert.severity} /><strong>{title}</strong><span className="evidence-origin">{alert.alertType.toUpperCase()}</span></div><p>{alert.matchedCondition ?? (alert.alertType === "ai" ? `Anomaly score ${formatProbability(alert.anomalyScore)}` : "No matched condition recorded")}</p><div className="evidence-metadata"><span>Weight <strong>{alert.weight.toFixed(2)}</strong></span>{alert.confidence !== null ? <span>Confidence <strong>{formatProbability(alert.confidence)}</strong></span> : null}<span>Events <strong>{alert.matchedEventIds.length}</strong></span>{alert.modelVersion ? <code>{alert.modelVersion}</code> : null}</div><TagList values={alert.tags} /></div><time title={formatDateTime(alert.createdAt)}>{formatRelativeTime(alert.createdAt)}</time></article>;
}

function EventsPanel({ resource, page, onPage }: { readonly resource: Resource<IncidentEventPage>; readonly page: number; readonly onPage: (page: number) => void }) {
  if (resource.loading && !resource.data) return <SectionLoading label="Loading normalized events" />;
  if (resource.error && !resource.data) return <SectionError message={resource.error} onRetry={resource.refresh} />;
  if (!resource.data) return null;
  return <section className="enterprise-panel incident-section-panel"><PanelHeader title="Normalized events" description="Tenant-scoped OCSF evidence linked to this incident" meta={`${resource.data.pagination.total} total`} />{resource.error ? <InlineError message={resource.error} onRetry={resource.refresh} /> : null}<div className="table-scroll"><table className="data-table incident-events-table"><thead><tr><th>Time</th><th>Severity</th><th>Event</th><th>Source</th><th>Destination</th><th>OCSF class</th><th>Collector</th><th /></tr></thead><tbody>{resource.data.data.length ? resource.data.data.map((event) => <EventRow event={event} key={event.eventId} />) : <tr><td colSpan={8}><EmptyState icon={<Database size={20} />} title="No events found" text="No normalized event evidence is available on this page." compact /></td></tr>}</tbody></table></div><Pagination pagination={resource.data.pagination} page={page} onPage={onPage} /></section>;
}

function EventRow({ event }: { readonly event: IncidentEvent }) {
  return <tr><td className="timestamp-cell" title={formatDateTime(event.time)}>{formatRelativeTime(event.time)}</td><td><OcsfSeverity value={event.severityId} /></td><td className="event-message-cell"><strong>{event.message || "No event message"}</strong><code title={event.eventId}>{shortId(event.eventId)}</code></td><td className="technical-value">{endpointLabel(event.srcEndpoint)}</td><td className="technical-value">{endpointLabel(event.dstEndpoint)}</td><td className="technical-value">{event.classUid} / {event.categoryUid}</td><td className="collector-cell"><strong>{event.ingestion.collectorId}</strong><span>{formatDateTime(event.ingestion.ingestedAt)}</span></td><td><Link className="table-action-link" href={`/investigate?eventId=${encodeURIComponent(event.eventId)}`} title="Pivot to investigation"><ExternalLink size={13} /></Link></td></tr>;
}

function AiPanel({ resource, page, onPage }: { readonly resource: Resource<IncidentAlertPage>; readonly page: number; readonly onPage: (page: number) => void }) {
  if (resource.loading && !resource.data) return <SectionLoading label="Loading AI evidence" />;
  if (resource.error && !resource.data) return <SectionError message={resource.error} onRetry={resource.refresh} />;
  const aiAlerts = resource.data?.data.filter((alert) => alert.alertType === "ai") ?? [];
  return <section className="enterprise-panel incident-section-panel"><PanelHeader title="AI explanation" description="Persisted anomaly scores and feature contributions" meta={`${aiAlerts.length} on this page`} />{resource.error ? <InlineError message={resource.error} onRetry={resource.refresh} /> : null}<div className="ai-analysis-list">{aiAlerts.length ? aiAlerts.map((alert) => <AiExplanation alert={alert} key={alert.id} />) : <EmptyState icon={<Bot size={22} />} title="No AI explanation available" text="This incident page has no AI alert with persisted model evidence." />}</div>{resource.data ? <Pagination pagination={resource.data.pagination} page={page} onPage={onPage} /> : null}</section>;
}

function AiExplanation({ alert }: { readonly alert: IncidentAlert }) {
  const features = numericEntries(alert.shapValues).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
  const max = Math.max(...features.map(([, value]) => Math.abs(value)), 0.000001);
  return <article className="ai-explanation"><div className="ai-score-summary"><div><span>Anomaly score</span><strong>{formatProbability(alert.anomalyScore)}</strong></div><div><span>Confidence</span><strong>{formatProbability(alert.confidence)}</strong></div><div><span>Model</span><code>{alert.modelVersion ?? "Not recorded"}</code></div></div><h3>Top feature contributions</h3>{features.length ? <div className="shap-list">{features.map(([name, value]) => <div className="shap-row" key={name}><code>{formatSource(name)}</code><div className={value >= 0 ? "positive" : "negative"}><i style={{ width: `${Math.abs(value) / max * 100}%` }} /></div><strong>{value > 0 ? "+" : ""}{value.toFixed(3)}</strong></div>)}</div> : <EmptyInline text="No numeric SHAP contributions were persisted for this alert." />}</article>;
}

function TimelinePanel({ resource, page, onPage }: { readonly resource: Resource<IncidentTimelinePage>; readonly page: number; readonly onPage: (page: number) => void }) {
  if (resource.loading && !resource.data) return <SectionLoading label="Loading incident timeline" />;
  if (resource.error && !resource.data) return <SectionError message={resource.error} onRetry={resource.refresh} />;
  if (!resource.data) return null;
  return <section className="enterprise-panel incident-section-panel"><PanelHeader title="Incident timeline" description="Chronological events, alerts, notes, and analyst actions" meta={`${resource.data.pagination.total} entries`} />{resource.error ? <InlineError message={resource.error} onRetry={resource.refresh} /> : null}<div className="incident-timeline">{resource.data.data.length ? resource.data.data.map((entry) => <TimelineRow entry={entry} key={entry.id} />) : <EmptyState icon={<Clock3 size={20} />} title="No timeline entries" text="No activity was recorded for this incident." compact />}</div><Pagination pagination={resource.data.pagination} page={page} onPage={onPage} /></section>;
}

function TimelineRow({ entry }: { readonly entry: IncidentTimelineEntry }) {
  const content = entry.type === "event" ? { title: entry.eventMessage ?? "Normalized event", detail: `Event ${shortId(entry.eventId)} · OCSF ${entry.eventClassUid ?? "—"}` } : entry.type === "alert" ? { title: entry.alertTitle, detail: `${entry.alertType.toUpperCase()} alert · ${formatSeverity(entry.alertSeverity)}${entry.anomalyScore === null ? "" : ` · score ${formatProbability(entry.anomalyScore)}`}` } : { title: actionTitle(entry), detail: entry.noteContent ?? `${entry.previousValue ?? "—"} → ${entry.newValue ?? "—"}` };
  return <article className={`timeline-entry ${entry.type}`}><i>{entry.type === "event" ? <Database size={13} /> : entry.type === "alert" ? <AlertTriangle size={13} /> : <Activity size={13} />}</i><div><strong>{content.title}</strong><span>{content.detail}</span>{entry.type === "action" ? <small>Actor: {entry.actorName}</small> : null}</div><time title={formatDateTime(entry.timestamp)}>{formatDateTime(entry.timestamp)}</time></article>;
}

function Pagination({ pagination, page, onPage }: { readonly pagination: IncidentPagination; readonly page: number; readonly onPage: (page: number) => void }) {
  if (pagination.totalPages <= 1) return null;
  return <footer className="incident-pagination"><span>{formatCount(pagination.total)} results · {pagination.limit} per page</span><div><button type="button" disabled={!pagination.hasPrev} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button><span>Page <strong>{pagination.page}</strong> of {pagination.totalPages}</span><button type="button" disabled={!pagination.hasNext} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button></div></footer>;
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) { return <div className="incident-fact"><small>{label}</small><div>{children}</div></div>; }
function PanelHeader({ title, description, meta }: { readonly title: string; readonly description: string; readonly meta?: string }) { return <div className="panel-header"><div><h2>{title}</h2><p>{description}</p></div>{meta ? <span className="panel-meta">{meta}</span> : null}</div>; }
function Definition({ label, value, technical = false }: { readonly label: string; readonly value: string; readonly technical?: boolean }) { return <div className="incident-definition"><small>{label}</small><strong className={technical ? "technical-value" : ""} title={value}>{value}</strong></div>; }
function SeverityBadge({ severity }: { readonly severity: IncidentDetailModel["severity"] }) { return <span className={`severity-badge ${severity}`}><i />{formatSeverity(severity)}</span>; }
function OcsfSeverity({ value }: { readonly value: number }) { const label = value >= 5 ? "Critical" : value === 4 ? "High" : value === 3 ? "Medium" : value === 2 ? "Low" : "Info"; return <span className={`ocsf-severity severity-${value}`}>{label}</span>; }
function TagList({ values }: { readonly values: readonly unknown[] }) { const tags = values.filter((value): value is string => typeof value === "string").slice(0, 6); return tags.length ? <div className="evidence-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null; }
function EmptyInline({ text }: { readonly text: string }) { return <p className="empty-inline">{text}</p>; }
function EmptyState({ icon, title, text, compact = false }: { readonly icon: ReactNode; readonly title: string; readonly text: string; readonly compact?: boolean }) { return <div className={compact ? "incident-empty-state compact" : "incident-empty-state"}>{icon}<strong>{title}</strong><span>{text}</span></div>; }
function SectionLoading({ label }: { readonly label: string }) { return <section className="enterprise-panel section-loading" aria-busy="true" aria-label={label}>{Array.from({ length: 7 }, (_, index) => <span className="skeleton-line" key={index} />)}</section>; }
function SectionError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <section className="enterprise-panel"><EmptyState icon={<AlertTriangle size={22} />} title="Section unavailable" text={message} /><button className="section-retry secondary-button" type="button" onClick={onRetry}>Retry</button></section>; }
function InlineError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <div className="incident-inline-error" role="alert"><AlertTriangle size={14} /><span>{message}</span><button type="button" onClick={onRetry}>Retry</button></div>; }
function DetailSkeleton() { return <section className="incident-detail-page" aria-busy="true"><div className="incident-detail-header detail-skeleton"><span className="skeleton-line short" /><span className="skeleton-line heading" /><span className="skeleton-line medium" /></div><div className="enterprise-panel skeleton-table" /></section>; }
function DetailError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <section className="incident-detail-page"><Link className="detail-back-link" href="/incidents"><ArrowLeft size={14} />Incident queue</Link><div className="enterprise-panel detail-error"><AlertTriangle size={26} /><h1>Incident unavailable</h1><p>{message}</p><button className="secondary-button" type="button" onClick={onRetry}>Retry request</button></div></section>; }

function endpointLabel(value: Readonly<Record<string, unknown>> | undefined): string { if (!value) return "—"; for (const key of ["ip", "hostname", "name"]) { const candidate = value[key]; if (typeof candidate === "string" && candidate.trim()) return candidate; } return "—"; }
function numericEntries(value: Readonly<Record<string, unknown>> | null): [string, number][] {
  if (!value) return [];
  const features = value.features;
  if (Array.isArray(features)) {
    return features.flatMap((feature): [string, number][] => {
      if (!feature || typeof feature !== "object") return [];
      const record = feature as Readonly<Record<string, unknown>>;
      const name = record.name;
      const contribution = record.shapValue ?? record.shap_value;
      return typeof name === "string" && typeof contribution === "number" && Number.isFinite(contribution) ? [[name, contribution]] : [];
    });
  }
  return Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]));
}
function formatProbability(value: number | null): string { return value === null ? "Not available" : `${(value * 100).toFixed(1)}%`; }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function actionTitle(entry: Extract<IncidentTimelineEntry, { type: "action" }>): string { if (entry.action === "note_added") return "Investigation note added"; if (entry.action === "status_change") return "Incident status changed"; if (entry.action === "assigned") return "Assignment changed"; if (entry.action === "created") return "Incident created"; return "Incident updated"; }
