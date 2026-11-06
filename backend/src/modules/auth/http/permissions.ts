import type { AuthRole } from "../domain/index.js";

export type Permission =
  | "audit.view"
  | "assets.view"
  | "assets.create"
  | "assets.edit"
  | "assets.delete"
  | "dashboard.view"
  | "config.view"
  | "config.modify"
  | "config.ai_threshold"
  | "users.manage"
  | "rules.create"
  | "rules.delete"
  | "rules.edit"
  | "rules.enable"
  | "rules.export"
  | "rules.import"
  | "rules.test"
  | "rules.view"
  | "events.view"
  | "incidents.view"
  | "incidents.assign";

const ROLE_PERMISSIONS: Record<AuthRole, ReadonlySet<Permission>> = {
  admin: new Set([
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
  ]),
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

export function roleHasPermission(
  role: AuthRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
