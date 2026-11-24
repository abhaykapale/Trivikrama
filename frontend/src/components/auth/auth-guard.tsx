"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { LoadingScreen } from "@/components/feedback/loading-screen";

export function AuthGuard({ children }: { readonly children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      router.replace(`/login${next}`);
    }
  }, [pathname, router, status]);

  if (status !== "authenticated") return <LoadingScreen />;
  return children;
}
