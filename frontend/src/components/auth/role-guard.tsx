"use client";

import type { ReactNode } from "react";
import { usePermission } from "@/hooks/use-permission";
import type { Permission } from "@/utils/permissions";

export function RoleGuard({ permission, children, fallback = null }: {
  readonly permission: Permission;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}
