"use client";

import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/components/auth/auth-provider";

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 4000, className: "app-toast" }} />
    </AuthProvider>
  );
}
