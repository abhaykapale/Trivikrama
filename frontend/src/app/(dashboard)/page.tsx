import { PermissionGuard } from "@/components/auth/permission-guard";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default function FoundationDashboardPage() {
  return (
    <PermissionGuard permission="dashboard.view">
      <DashboardView />
    </PermissionGuard>
  );
}
