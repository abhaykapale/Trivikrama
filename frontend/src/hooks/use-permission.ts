"use client";

import { useAuth } from "./use-auth";
import { roleHasPermission, type Permission } from "@/utils/permissions";

export function usePermission(permission: Permission): boolean {
  const { user } = useAuth();
  return user ? roleHasPermission(user.role, permission) : false;
}
