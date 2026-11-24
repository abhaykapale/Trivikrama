import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { z } from "zod";
import { ApiError, type ApiErrorBody } from "@/types/api";
import { getBrowserCookie } from "@/utils/cookies";
import { isUnsafeHttpMethod } from "@/utils/http-security";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
const CSRF_COOKIE_NAME = "siem_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export const apiClient = axios.create({
  baseURL: API_BASE_URL.replace(/\/$/u, ""),
  timeout: 15_000,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

apiClient.interceptors.request.use((config) => addCsrfHeader(config));
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const normalized = normalizeApiError(error);
    if (normalized.status === 401) unauthorizedHandler?.();
    return Promise.reject(normalized);
  },
);

function addCsrfHeader(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const method = config.method?.toLowerCase();
  if (!isUnsafeHttpMethod(method)) return config;

  const csrfToken = getBrowserCookie(CSRF_COOKIE_NAME);
  if (!csrfToken) return config;

  const headers = AxiosHeaders.from(config.headers);
  headers.set(CSRF_HEADER_NAME, csrfToken);
  config.headers = headers;
  return config;
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (error.code === "ERR_CANCELED") {
      return new ApiError("The request was superseded.", "REQUEST_CANCELED", null);
    }

    const body = error.response?.data;
    if (body?.error && typeof body.error.message === "string") {
      return new ApiError(
        body.error.message,
        body.error.code,
        error.response?.status ?? null,
        body.error.details,
      );
    }

    if (error.code === "ECONNABORTED") {
      return new ApiError("The request timed out. Please try again.", "REQUEST_TIMEOUT", null);
    }

    if (!error.response) {
      return new ApiError(
        "The security platform is unavailable. Check the backend connection.",
        "NETWORK_ERROR",
        null,
      );
    }

    return new ApiError("The request could not be completed.", "HTTP_ERROR", error.response.status);
  }

  if (error instanceof z.ZodError) {
    return new ApiError("The server returned an unexpected response.", "INVALID_RESPONSE", null, {
      issues: error.issues,
    });
  }

  return new ApiError("An unexpected error occurred.", "UNKNOWN_ERROR", null);
}
