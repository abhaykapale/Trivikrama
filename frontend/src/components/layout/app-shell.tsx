"use client";

import { useState, type ReactNode } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  return (
    <div className="app-shell">
      <Sidebar open={navigationOpen} onClose={() => setNavigationOpen(false)} />
      <div className="app-column">
        <Header onOpenNavigation={() => setNavigationOpen(true)} />
        <main className="app-main" id="main-content">{children}</main>
      </div>
    </div>
  );
}
