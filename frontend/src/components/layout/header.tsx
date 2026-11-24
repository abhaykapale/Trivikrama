"use client";

import { LogOut, Menu, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatRole } from "@/utils/permissions";

export function Header({ onOpenNavigation }: { readonly onOpenNavigation: () => void }) {
  const { user, logout } = useAuth();
  const name = user?.displayName?.trim() || user?.username || "User";
  const initials = name.split(/\s+/u).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

  return (
    <header className="app-header">
      <button className="menu-button" type="button" onClick={onOpenNavigation} aria-label="Open navigation"><Menu size={22} /></button>
      <div className="environment-status"><ShieldCheck size={16} aria-hidden="true" /><span>Security Operations</span><span className="header-separator">/</span><strong>Protected workspace</strong></div>
      <div className="header-user">
        <div className="avatar" aria-hidden="true">{initials}</div>
        <div className="user-copy"><strong>{name}</strong><span>{user ? formatRole(user.role) : ""}</span></div>
        <button className="icon-button" type="button" onClick={() => void logout()} aria-label="Sign out"><LogOut size={19} /></button>
      </div>
    </header>
  );
}
