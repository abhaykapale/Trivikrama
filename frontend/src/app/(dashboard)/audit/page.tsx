import { ScrollText } from "lucide-react";
import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { PermissionGuard } from "@/components/auth/permission-guard";
export default function Page() { return <PermissionGuard permission="audit.view"><ModulePlaceholder title="Audit log" description="Immutable security and administrative activity." icon={ScrollText} /></PermissionGuard>; }
