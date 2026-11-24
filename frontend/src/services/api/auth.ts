import type { SafeSession, SessionUser } from "@/types/auth";
import { ApiError } from "@/types/api";
import { apiClient, normalizeApiError } from "./client";
import {
  currentUserResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  refreshResponseSchema,
  type LoginRequest,
} from "./schemas";

export async function login(input: LoginRequest): Promise<SafeSession> {
  try {
    const parsed = loginRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError(
        parsed.error.issues[0]?.message ?? "Invalid credentials.",
        "VALIDATION_ERROR",
        null,
        { issues: parsed.error.issues },
      );
    }
    const request = parsed.data;
    const response = await apiClient.post<unknown>("/auth/login", request);
    return loginResponseSchema.parse(response.data);
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}

export async function getCurrentUser(): Promise<SessionUser> {
  try {
    const response = await apiClient.get<unknown>("/auth/me", { headers: { "Cache-Control": "no-store" } });
    return currentUserResponseSchema.parse(response.data).user;
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}

export async function refreshSession(): Promise<{ readonly expiresAt: string }> {
  try {
    const response = await apiClient.post<unknown>("/auth/refresh");
    return refreshResponseSchema.parse(response.data);
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}

export async function logout(): Promise<void> {
  try {
    const response = await apiClient.post<unknown>("/auth/logout");
    logoutResponseSchema.parse(response.data);
  } catch (error: unknown) {
    throw normalizeApiError(error);
  }
}
