import type { LucideIcon } from "lucide-react";

export function ModulePlaceholder({ title, description, icon: Icon }: {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
}) {
  return (
    <section className="page-stack">
      <div className="page-heading"><div><span className="eyebrow">Security operations</span><h1>{title}</h1><p>{description}</p></div></div>
      <section className="enterprise-panel">
        <div className="panel-header"><div><h2>Module status</h2><p>Secure application route</p></div><span className="status-label neutral">Integration pending</span></div>
        <div className="module-status-row">
          <div className="placeholder-icon"><Icon size={19} /></div>
          <div><strong>Workspace route available</strong><p>Authentication and permission controls are active. Operational data and actions will be connected in the approved module milestone.</p></div>
        </div>
      </section>
    </section>
  );
}
