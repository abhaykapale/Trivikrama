import { notFound } from "next/navigation";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { RuleDetailWorkspace } from "@/components/rules/rule-workspace";
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) { const { id } = await params; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) notFound(); return <PermissionGuard permission="rules.view"><RuleDetailWorkspace key={id} id={id} /></PermissionGuard>; }
