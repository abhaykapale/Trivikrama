import { PermissionGuard } from "@/components/auth/permission-guard";
import { RuleAuthoring } from "@/components/rules/rule-authoring";
export default function Page() { return <PermissionGuard permission="rules.create"><RuleAuthoring /></PermissionGuard>; }
