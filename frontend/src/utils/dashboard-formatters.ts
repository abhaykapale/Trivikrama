import type { DashboardRange, Severity } from "@/types/dashboard";

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const standardNumber = new Intl.NumberFormat("en");

export function formatCount(value: number): string {
  return value >= 10_000 ? compactNumber.format(value) : standardNumber.format(value);
}

export function formatRate(value: number): string {
  return value < 10 ? value.toFixed(2) : value.toLocaleString("en", { maximumFractionDigits: 1 });
}

export function formatMinutes(value: number): string {
  if (value < 60) return `${value.toLocaleString("en", { maximumFractionDigits: 1 })}m`;
  return `${(value / 60).toLocaleString("en", { maximumFractionDigits: 1 })}h`;
}

export function formatTrend(value: number): string {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en", { maximumFractionDigits: 1 })}%`;
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : formatDateTime(value);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatAxisTime(value: string, range: DashboardRange): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return range === "7d" || range === "30d"
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)
    : new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function formatSeverity(value: Severity): string {
  return value === "informational" ? "Info" : value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatSource(value: string): string {
  return value.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
