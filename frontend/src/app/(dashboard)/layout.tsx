import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({ children }: { readonly children: ReactNode }) {
  return <AuthGuard><AppShell>{children}</AppShell></AuthGuard>;
}
