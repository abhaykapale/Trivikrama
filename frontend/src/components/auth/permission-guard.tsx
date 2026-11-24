"use client";

import type { ReactNode } from "react";
import { ShieldX } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";
import type { Permission } from "@/utils/permissions";

export function PermissionGuard({ permission, children }: {
  readonly permission: Permission;
  readonly children: ReactNode;
}) {
  const allowed = usePermission(permission);

  if (!allowed) {
    return (
      <section className="access-denied" role="alert">
        <ShieldX size={34} aria-hidden="true" />
        <h1>Access restricted</h1>
        <p>Your account does not have permission to open this workspace.</p>
      </section>
    );
  }

  return children;
}
