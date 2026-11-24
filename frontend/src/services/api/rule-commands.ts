import { apiClient, normalizeApiError } from "./client";
import { createdRuleSchema, dryRunSchema, validationSchema } from "./rule-command-schemas";
async function post<T>(url: string, body: unknown, schema: { parse(value: unknown): T }) { try { const response = await apiClient.post<unknown>(url, body); return schema.parse(response.data); } catch (error: unknown) { throw normalizeApiError(error); } }
export function validateRule(yamlContent: string) { return post("/rules/validate", { yamlContent }, validationSchema); }
export function createRule(yamlContent: string) { return post("/rules", { yamlContent }, createdRuleSchema); }
export function testRule(id: string, timeRange: string, limit: number) { return post(`/rules/${encodeURIComponent(id)}/test`, { timeRange, limit }, dryRunSchema); }
