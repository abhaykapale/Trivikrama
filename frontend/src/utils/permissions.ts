import type { UserRole } from "@/types/auth";

export const PERMISSIONS = [
  "audit.view",
  "assets.view",
  "assets.create",
  "assets.edit",
  "assets.delete",
  "dashboard.view",
  "config.view",
  "config.modify",
  "config.ai_threshold",
  "users.manage",
  "rules.create",
  "rules.delete",
  "rules.edit",
  "rules.enable",
  "rules.export",
  "rules.import",
  "rules.test",
  "rules.view",
  "events.view",
  "incidents.view",
  "incidents.assign",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  admin: new Set(PERMISSIONS),
  security_engineer: new Set([
    "audit.view",
    "assets.view",
    "assets.create",
    "assets.edit",
    "dashboard.view",
    "config.ai_threshold",
    "rules.create",
    "rules.edit",
    "rules.enable",
    "rules.export",
    "rules.import",
    "rules.test",
    "rules.view",
    "events.view",
    "incidents.view",
    "incidents.assign",
  ]),
  soc_analyst: new Set([
    "assets.view",
    "dashboard.view",
    "rules.export",
    "rules.test",
    "rules.view",
    "events.view",
    "incidents.view",
  ]),
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function getPermissionsForRole(role: UserRole): readonly Permission[] {
  return PERMISSIONS.filter((permission) => roleHasPermission(role, permission));
}

export function formatRole(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: "Administrator",
    security_engineer: "Security Engineer",
    soc_analyst: "SOC Analyst",
  };
  return labels[role];
}
