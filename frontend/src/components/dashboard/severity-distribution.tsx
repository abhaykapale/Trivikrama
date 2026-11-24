import type { DashboardSummary, Severity } from "@/types/dashboard";
import { SEVERITIES } from "@/types/dashboard";
import { formatCount, formatSeverity } from "@/utils/dashboard-formatters";

export function SeverityDistribution({ summary }: { readonly summary: DashboardSummary }) {
  const total = SEVERITIES.reduce((sum, severity) => sum + summary.severityDistribution[severity], 0);
  return (
    <section className="enterprise-panel severity-panel" aria-labelledby="severity-title">
      <div className="panel-header"><div><h2 id="severity-title">Severity distribution</h2><p>Incidents in the selected range</p></div><span className="panel-meta">{formatCount(total)} total</span></div>
      <div className="severity-list">
        {SEVERITIES.map((severity) => {
          const count = summary.severityDistribution[severity];
          const percentage = total === 0 ? 0 : (count / total) * 100;
          return <SeverityRow key={severity} severity={severity} count={count} percentage={percentage} />;
        })}
      </div>
    </section>
  );
}

function SeverityRow({ severity, count, percentage }: { readonly severity: Severity; readonly count: number; readonly percentage: number }) {
  return (
    <div className="severity-row">
      <span className={`severity-dot ${severity}`} aria-hidden="true" />
      <span className="severity-name">{formatSeverity(severity)}</span>
      <div className="severity-track"><span className={`severity-fill ${severity}`} style={{ width: `${percentage}%` }} /></div>
      <strong>{formatCount(count)}</strong>
      <span className="severity-percent">{percentage.toFixed(1)}%</span>
    </div>
  );
}
