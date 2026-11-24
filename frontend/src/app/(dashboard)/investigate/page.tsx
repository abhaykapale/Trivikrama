import { Suspense } from "react";
import { InvestigationWorkspace } from "@/components/events/investigation-workspace";
import { PermissionGuard } from "@/components/auth/permission-guard";
export default function Page() { return <PermissionGuard permission="events.view"><Suspense fallback={<p aria-busy="true">Loading investigation workspace…</p>}><InvestigationWorkspace /></Suspense></PermissionGuard>; }
