import type { CSSProperties } from "react";
import type { DashboardSourceBreakdown, DashboardTopAssets } from "@/types/dashboard";
import { formatCount, formatDateTime, formatSource } from "@/utils/dashboard-formatters";

export function OperationalBreakdown({ assets, sources }: { readonly assets: DashboardTopAssets | null; readonly sources: DashboardSourceBreakdown | null }) {
  return (
    <div className="dashboard-bottom-grid">
      <section className="enterprise-panel" aria-labelledby="top-assets-title">
        <div className="panel-header"><div><h2 id="top-assets-title">Top affected entities</h2><p>Ranked by incident count</p></div></div>
        <div className="table-scroll">
          <table className="data-table compact-table">
            <thead><tr><th>Entity</th><th>Type</th><th>Incidents</th><th>Critical / High</th><th>Latest</th></tr></thead>
            <tbody>
              {assets === null ? <tr><td colSpan={5}><div className="table-empty">Affected entity data is unavailable.</div></td></tr> : assets.assets.length === 0 ? <tr><td colSpan={5}><div className="table-empty">No affected entities in this range.</div></td></tr> : assets.assets.map((asset) => (
                <tr key={`${asset.entityType}:${asset.entity}`}><td className="technical-value entity-cell">{asset.entity}</td><td>{formatSource(asset.entityType)}</td><td>{formatCount(asset.incidentCount)}</td><td><span className="critical-count">{asset.criticalCount}</span><span className="count-separator">/</span><span className="high-count">{asset.highCount}</span></td><td className="timestamp-cell">{formatDateTime(asset.latestIncidentAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="enterprise-panel" aria-labelledby="source-breakdown-title">
        <div className="panel-header"><div><h2 id="source-breakdown-title">Events by source</h2><p>Normalized source distribution</p></div>{sources ? <span className="panel-meta">{formatCount(sources.total)} events</span> : null}</div>
        <div className="source-list">
          {sources === null ? <div className="compact-empty">Event source data is unavailable.</div> : sources.sources.length === 0 ? <div className="compact-empty">No event sources in this range.</div> : sources.sources.slice(0, 8).map((source) => (
            <div className="source-row" key={source.source}>
              <div className="source-row-heading"><span title={source.source}>{formatSource(source.source)}</span><strong>{formatCount(source.eventCount)}</strong><em>{source.percentage.toFixed(1)}%</em></div>
              <div className="source-track"><span style={{ "--source-width": `${source.percentage}%` } as CSSProperties} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
