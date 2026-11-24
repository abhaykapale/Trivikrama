import { Activity, BookOpenCheck, FileSearch, Gauge, ScrollText, Settings, ShieldAlert, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Permission } from "@/utils/permissions";

export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly permission?: Permission;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: "/", label: "Dashboard", icon: Gauge, permission: "dashboard.view" },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert, permission: "incidents.view" },
  { href: "/investigate", label: "Investigation", icon: FileSearch, permission: "events.view" },
  { href: "/rules", label: "Sigma rules", icon: BookOpenCheck, permission: "rules.view" },
  { href: "/collector", label: "Collector", icon: Activity },
  { href: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.view" },
  { href: "/settings", label: "Configuration", icon: Settings, permission: "config.view" },
  { href: "/settings/users", label: "Users", icon: UsersRound, permission: "users.manage" },
];
