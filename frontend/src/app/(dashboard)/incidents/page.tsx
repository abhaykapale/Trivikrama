import { Suspense } from "react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { IncidentQueue } from "@/components/incidents/incident-queue";

export default function IncidentsPage() {
  return (
    <PermissionGuard permission="incidents.view">
      <Suspense fallback={<IncidentQueueFallback />}>
        <IncidentQueue />
      </Suspense>
    </PermissionGuard>
  );
}

function IncidentQueueFallback() {
  return (
    <section className="incident-queue-page" aria-label="Loading incident queue" aria-busy="true">
      <header className="incident-queue-heading"><div><span className="skeleton-line short" /><span className="skeleton-line heading" /><span className="skeleton-line medium" /></div></header>
      <div className="enterprise-panel skeleton-table" />
    </section>
  );
}
