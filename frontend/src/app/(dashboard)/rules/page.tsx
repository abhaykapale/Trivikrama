import { Suspense } from "react";
import { RuleWorkspace } from "@/components/rules/rule-workspace";
import { PermissionGuard } from "@/components/auth/permission-guard";
export default function Page() { return <PermissionGuard permission="rules.view"><Suspense fallback={<p aria-busy="true">Loading rule workspace…</p>}><RuleWorkspace /></Suspense></PermissionGuard>; }
