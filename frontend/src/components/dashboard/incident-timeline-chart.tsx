"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardRange, DashboardTimeline } from "@/types/dashboard";
import { formatAxisTime } from "@/utils/dashboard-formatters";

const CHART_COLORS = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  informational: "#64748b",
} as const;

export function IncidentTimelineChart({ timeline, range }: { readonly timeline: DashboardTimeline; readonly range: DashboardRange }) {
  const hasData = timeline.buckets.some((bucket) => bucket.total > 0);
  return (
    <section className="enterprise-panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-header">
        <div><h2 id="timeline-title">Incident activity</h2><p>Created incidents by severity and time bucket</p></div>
        <span className="panel-meta">Interval {timeline.interval}</span>
      </div>
      <div className="chart-legend" aria-label="Severity legend">
        {Object.entries(CHART_COLORS).map(([severity, color]) => <span key={severity}><i style={{ backgroundColor: color }} />{severity === "informational" ? "Info" : severity}</span>)}
      </div>
      <div className="timeline-chart" aria-label="Stacked incident activity chart">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeline.buckets} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1c252d" vertical={false} />
              <XAxis dataKey="timestamp" tickFormatter={(value: string) => formatAxisTime(value, range)} stroke="#58636e" tick={{ fill: "#7f8b97", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#27313a" }} minTickGap={28} />
              <YAxis allowDecimals={false} stroke="#58636e" tick={{ fill: "#7f8b97", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#151c23", border: "1px solid #27313a", borderRadius: 3, fontSize: 11 }} labelFormatter={(value) => new Date(String(value)).toLocaleString()} cursor={{ fill: "rgba(255,255,255,.025)" }} />
              <Bar dataKey="critical" name="Critical" stackId="severity" fill={CHART_COLORS.critical} maxBarSize={24} />
              <Bar dataKey="high" name="High" stackId="severity" fill={CHART_COLORS.high} maxBarSize={24} />
              <Bar dataKey="medium" name="Medium" stackId="severity" fill={CHART_COLORS.medium} maxBarSize={24} />
              <Bar dataKey="low" name="Low" stackId="severity" fill={CHART_COLORS.low} maxBarSize={24} />
              <Bar dataKey="informational" name="Informational" stackId="severity" fill={CHART_COLORS.informational} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState label="No incidents were created in this time range." />}
      </div>
    </section>
  );
}

export function ChartEmptyState({ label }: { readonly label: string }) {
  return <div className="chart-empty"><span>No activity</span><p>{label}</p></div>;
}
