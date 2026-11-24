import { apiClient, normalizeApiError } from "./client";
import { ruleDetailSchema, rulePageSchema } from "./rule-schemas";
export async function listRules(params: Record<string, string | number>, signal: AbortSignal) {
  try { const response = await apiClient.get<unknown>("/rules", { params, signal, headers: { "Cache-Control": "no-store" } }); return rulePageSchema.parse(response.data); } catch (error: unknown) { throw normalizeApiError(error); }
}
export async function getRule(id: string, signal: AbortSignal) {
  try { const response = await apiClient.get<unknown>(`/rules/${encodeURIComponent(id)}`, { signal, headers: { "Cache-Control": "no-store" } }); return ruleDetailSchema.parse(response.data); } catch (error: unknown) { throw normalizeApiError(error); }
}
