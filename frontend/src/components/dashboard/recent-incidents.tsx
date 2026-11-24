import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { RecentIncidentPage, Severity } from "@/types/dashboard";
import { formatCount, formatRelativeTime, formatSeverity } from "@/utils/dashboard-formatters";
import type { RealtimeConnectionStatus } from "@/services/websocket/incident-websocket";

export function RecentIncidents({ incidents, realtimeStatus }: { readonly incidents: RecentIncidentPage; readonly realtimeStatus: RealtimeConnectionStatus }) {
  return (
    <section className="enterprise-panel recent-incidents-panel" aria-labelledby="recent-incidents-title">
      <div className="panel-header">
        <div><h2 id="recent-incidents-title">Recent incidents</h2><p>Newest tenant-scoped incidents requiring review</p></div>
        <div className="panel-actions"><RealtimeStatus status={realtimeStatus} /><Link className="text-link" href="/incidents">View all <ArrowRight size={13} /></Link></div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Severity</th><th>Incident</th><th>Status</th><th>Primary entity</th><th>Risk</th><th>Alerts</th><th>Created</th></tr></thead>
          <tbody>
            {incidents.data.length === 0 ? <tr><td colSpan={7}><div className="table-empty">No incidents were found.</div></td></tr> : incidents.data.map((incident) => (
              <tr key={incident.id}>
                <td><SeverityBadge severity={incident.severity} /></td>
                <td className="incident-title-cell"><Link href={`/incidents/${incident.id}`}>{incident.title}</Link><span>{incident.source === "both" ? "Rule + AI" : incident.source.toUpperCase()}</span></td>
                <td><span className={`status-badge ${incident.status}`}>{incident.status}</span></td>
                <td className="technical-value">{incident.primaryEntity ?? "—"}</td>
                <td><div className="risk-value"><span>{Math.round(incident.riskScore)}</span><i><b style={{ width: `${incident.riskScore}%` }} /></i></div></td>
                <td>{formatCount(incident.alertCount)}</td>
                <td className="timestamp-cell" title={new Date(incident.createdAt).toLocaleString()}>{formatRelativeTime(incident.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { readonly severity: Severity }) {
  return <span className={`severity-badge ${severity}`}><i />{formatSeverity(severity)}</span>;
}

function RealtimeStatus({ status }: { readonly status: RealtimeConnectionStatus }) {
  const label = status === "connected" ? "Live" : status === "connecting" ? "Connecting" : status === "reconnecting" ? "Reconnecting" : "Offline";
  return <span className={`realtime-status ${status}`}><i />{label}</span>;
}
