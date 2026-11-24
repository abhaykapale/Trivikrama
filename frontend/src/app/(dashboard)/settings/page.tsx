import { Settings } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { PermissionGuard } from "@/components/auth/permission-guard";
export default function Page() { return <PermissionGuard permission="config.view"><ModulePlaceholder title="Configuration" description="Administrator-managed operational configuration." icon={Settings} /></PermissionGuard>; }
