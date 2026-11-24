import { notFound } from "next/navigation";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { IncidentDetail } from "@/components/incidents/incident-detail";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export default async function IncidentDetailPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  return <PermissionGuard permission="incidents.view"><IncidentDetail incidentId={id} /></PermissionGuard>;
}
