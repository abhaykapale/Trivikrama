"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Bot, RefreshCw } from "lucide-react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useIncidentRealtime } from "@/hooks/use-incident-realtime";
import { DASHBOARD_RANGES, type DashboardRange } from "@/types/dashboard";
import { formatDateTime } from "@/utils/dashboard-formatters";
import { DashboardKpis } from "./dashboard-kpis";
import { IncidentTimelineChart } from "./incident-timeline-chart";
import { OperationalBreakdown } from "./operational-breakdown";
import { RecentIncidents } from "./recent-incidents";
import { SeverityDistribution } from "./severity-distribution";

export function DashboardView() {
  const [range, setRange] = useState<DashboardRange>("24h");
  const { data, errors, loading, refreshing, lastUpdated, refresh } = useDashboardData(range);
  const handleNotification = useCallback(() => void refresh(), [refresh]);
  const realtimeStatus = useIncidentRealtime(handleNotification);
  const errorCount = Object.keys(errors).length;

  if (loading && data.summary === null) return <DashboardSkeleton />;

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div><span className="eyebrow">Overview</span><h1>Security operations</h1><p>Tenant-wide detection, incident, and event activity.</p></div>
        <div className="dashboard-toolbar">
          <div className="range-selector" aria-label="Dashboard time range">
            {DASHBOARD_RANGES.map((value) => <button key={value} type="button" className={range === value ? "active" : ""} aria-pressed={range === value} onClick={() => setRange(value)}>{value}</button>)}
          </div>
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh dashboard data"><RefreshCw size={14} className={refreshing ? "spinning" : ""} />Refresh</button>
        </div>
      </div>

      <div className="dashboard-statusbar">
        <div><span>Last updated</span><strong>{lastUpdated ? formatDateTime(lastUpdated.toISOString()) : "Not available"}</strong></div>
        {data.summary ? <AiEngineStatus status={data.summary.aiEngine.status} modelVersion={data.summary.aiEngine.modelVersion} /> : null}
      </div>

      {errorCount > 0 ? <DashboardErrorBanner count={errorCount} onRetry={() => void refresh()} /> : null}
      {data.summary ? <DashboardKpis summary={data.summary} /> : <UnavailablePanel title="Summary metrics unavailable" />}

      <div className="dashboard-analysis-grid">
        {data.timeline ? <IncidentTimelineChart timeline={data.timeline} range={range} /> : <UnavailablePanel title="Incident activity unavailable" />}
        {data.summary ? <SeverityDistribution summary={data.summary} /> : <UnavailablePanel title="Severity distribution unavailable" />}
      </div>

      {data.incidents ? <RecentIncidents incidents={data.incidents} realtimeStatus={realtimeStatus} /> : <UnavailablePanel title="Recent incidents unavailable" />}
      <OperationalBreakdown assets={data.topAssets} sources={data.sources} />
    </section>
  );
}

function AiEngineStatus({ status, modelVersion }: { readonly status: "online" | "degraded" | "offline"; readonly modelVersion: string | null }) {
  return <div className="ai-engine-status"><Bot size={14} aria-hidden="true" /><span>AI engine</span><strong className={status}>{status}</strong>{modelVersion ? <code>{modelVersion}</code> : null}</div>;
}

function DashboardErrorBanner({ count, onRetry }: { readonly count: number; readonly onRetry: () => void }) {
  return <div className="dashboard-error" role="alert"><AlertTriangle size={16} /><div><strong>Some dashboard data could not be refreshed</strong><span>{count} {count === 1 ? "section is" : "sections are"} showing the last available result.</span></div><button type="button" onClick={onRetry}>Retry</button></div>;
}

function UnavailablePanel({ title }: { readonly title: string }) {
  return <section className="enterprise-panel unavailable-panel"><AlertTriangle size={18} /><strong>{title}</strong><span>Retry the dashboard request or verify backend availability.</span></section>;
}

function DashboardSkeleton() {
  return (
    <section className="dashboard-page" aria-label="Loading dashboard" aria-busy="true">
      <div className="dashboard-heading"><div><span className="skeleton-line short" /><span className="skeleton-line heading" /><span className="skeleton-line medium" /></div></div>
      <div className="kpi-strip skeleton-kpis">{Array.from({ length: 5 }, (_, index) => <div className="kpi-cell" key={index}><span className="skeleton-line short" /><span className="skeleton-line metric" /><span className="skeleton-line medium" /></div>)}</div>
      <div className="dashboard-analysis-grid"><div className="enterprise-panel skeleton-panel" /><div className="enterprise-panel skeleton-panel" /></div>
      <div className="enterprise-panel skeleton-table" />
    </section>
  );
}
