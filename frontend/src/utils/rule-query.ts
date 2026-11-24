export const RULE_FILTERS = ["search", "status", "type", "severity", "tag", "isBuiltin"] as const;
export function ruleQuery(params: URLSearchParams): Record<string, string | number> {
  const result: Record<string, string | number> = { page: 1, limit: 25, sort: "name", order: "asc" };
  const allowed: Record<string, readonly string[]> = { status: ["active", "disabled", "archived"], type: ["match", "count", "sequence"], severity: ["critical", "high", "medium", "low", "informational"], isBuiltin: ["true", "false"], sort: ["name", "severity", "status", "createdAt", "updatedAt"], order: ["asc", "desc"] };
  for (const key of [...RULE_FILTERS, "sort", "order"]) { const value = params.get(key)?.trim(); if (value && (!allowed[key] || allowed[key].includes(value))) result[key] = value.slice(0, 200); }
  const page = Number(params.get("page")); if (Number.isInteger(page) && page >= 1 && page <= 1000000) result.page = page;
  return result;
}
export function safeRuleReference(value: string): string | null { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
