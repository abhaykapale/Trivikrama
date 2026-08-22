import type { AuthRole } from "../domain/index.js";

export type Permission =
  | "audit.view"
  | "users.manage"
  | "rules.create"
  | "rules.delete"
  | "incidents.assign";

const ROLE_PERMISSIONS: Record<AuthRole, ReadonlySet<Permission>> = {
  admin: new Set([
    "audit.view",
    "users.manage",
    "rules.create",
    "rules.delete",
    "incidents.assign",
  ]),
  security_engineer: new Set([
    "audit.view",
    "rules.create",
    "incidents.assign",
  ]),
  soc_analyst: new Set([]),
};

export function roleHasPermission(
  role: AuthRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
