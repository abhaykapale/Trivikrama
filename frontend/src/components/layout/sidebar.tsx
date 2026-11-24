"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { roleHasPermission } from "@/utils/permissions";
import { NAVIGATION_ITEMS } from "./navigation";

export function Sidebar({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();

  const visibleItems = NAVIGATION_ITEMS.filter(
    (item) => user && (!item.permission || roleHasPermission(user.role, item.permission)),
  );

  return (
    <>
      <button className={open ? "sidebar-backdrop visible" : "sidebar-backdrop"} onClick={onClose} aria-label="Close navigation" />
      <aside className={open ? "sidebar open" : "sidebar"} aria-label="Primary navigation">
        <div className="brand-row">
          <Image src="/logo.svg" alt="" width={30} height={30} priority />
          <div>
            <strong>Trivikrama</strong>
            <span>Security Operations</span>
          </div>
          <button className="sidebar-close" type="button" onClick={onClose} aria-label="Close navigation"><X size={20} /></button>
        </div>

        <div className="nav-section-label">Operations</div>
        <nav>
          {visibleItems.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : item.href === "/settings"
                ? pathname === "/settings"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"} onClick={onClose} aria-current={active ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className="secure-dot" aria-hidden="true" />
          <div><strong>Session protected</strong><span>Tenant-isolated access</span></div>
        </div>
      </aside>
    </>
  );
}
