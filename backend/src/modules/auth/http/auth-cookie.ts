import type { Response } from "express";
import type { AppConfig } from "../../../config/index.js";

export const CSRF_COOKIE_NAME = "siem_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface ParsedAuthCookies {
  readonly authToken: string | null;
  readonly csrfToken: string | null;
}

export function parseAuthCookies(
  cookieHeader: string | string[] | undefined,
  config: AppConfig,
): ParsedAuthCookies {
  const cookies = parseCookieHeader(cookieHeader);

  return {
    authToken: cookies.get(config.jwt.cookie.name) ?? null,
    csrfToken: cookies.get(CSRF_COOKIE_NAME) ?? null,
  };
}

export function setAuthCookie(
  response: Response,
  token: string,
  config: AppConfig,
  expiresAt?: Date,
): void {
  response.cookie(config.jwt.cookie.name, token, {
    httpOnly: true,
    secure: config.jwt.cookie.secure,
    sameSite: config.jwt.cookie.sameSite,
    path: "/",
    maxAge: calculateCookieMaxAge(expiresAt),
  });
}

export function clearAuthCookie(
  response: Response,
  config: AppConfig,
): void {
  response.clearCookie(config.jwt.cookie.name, baseCookieOptions(config));
  response.clearCookie(CSRF_COOKIE_NAME, baseCookieOptions(config));
}

export function setCsrfCookie(
  response: Response,
  csrfToken: string,
  config: AppConfig,
): void {
  response.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...baseCookieOptions(config),
    httpOnly: false,
    maxAge: ONE_HOUR_MS,
  });
}

function calculateCookieMaxAge(expiresAt: Date | undefined): number {
  if (expiresAt === undefined) {
    return ONE_HOUR_MS;
  }

  const remainingMs = expiresAt.getTime() - Date.now();

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 0;
  }

  return Math.min(remainingMs, ONE_HOUR_MS);
}

function baseCookieOptions(config: AppConfig) {
  return {
    secure: config.jwt.cookie.secure,
    sameSite: config.jwt.cookie.sameSite,
    path: "/",
  } as const;
}

function parseCookieHeader(
  cookieHeader: string | string[] | undefined,
): Map<string, string> {
  const rawHeader = Array.isArray(cookieHeader)
    ? cookieHeader.join(";")
    : cookieHeader;
  const cookies = new Map<string, string>();

  if (rawHeader === undefined || rawHeader.trim().length === 0) {
    return cookies;
  }

  for (const pair of rawHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    if (name.length > 0) {
      cookies.set(name, decodeCookieValue(value));
    }
  }

  return cookies;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
