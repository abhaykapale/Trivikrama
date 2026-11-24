import type { ManagedUserPage } from "@/types/auth";
import { apiClient, normalizeApiError } from "./client";
import { managedUserPageSchema } from "./user-schemas";

export async function getActiveUsers(search: string, page: number, signal: AbortSignal): Promise<ManagedUserPage> {
  try {
    const response = await apiClient.get<unknown>("/users", { params: { page, limit: 20, isActive: "true", ...(search ? { search } : {}) }, signal, headers: { "Cache-Control": "no-store" } });
    return managedUserPageSchema.parse(response.data);
  } catch (error: unknown) { throw normalizeApiError(error); }
}
