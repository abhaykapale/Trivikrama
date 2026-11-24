import { UsersRound } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { PermissionGuard } from "@/components/auth/permission-guard";
export default function Page() { return <PermissionGuard permission="users.manage"><ModulePlaceholder title="User management" description="Administrator-controlled user lifecycle management." icon={UsersRound} /></PermissionGuard>; }
