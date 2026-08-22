import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../../config/index.js";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  parseAuthCookies,
} from "../../modules/auth/http/auth-cookie.js";
import { sendError } from "../../modules/auth/http/auth-http.errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfProtectionOptions {
  readonly config: AppConfig;
  readonly exemptPaths?: readonly string[];
}

export function csrfProtection(options: CsrfProtectionOptions) {
  const exemptPaths = new Set(options.exemptPaths ?? []);

  return (request: Request, response: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    if (exemptPaths.has(request.path) || exemptPaths.has(request.originalUrl)) {
      next();
      return;
    }

    if (hasBearerAuthorization(request)) {
      next();
      return;
    }

    const cookies = parseAuthCookies(request.headers.cookie, options.config);

    if (cookies.authToken === null) {
      next();
      return;
    }

    const csrfCookie = cookies.csrfToken;
    const csrfHeader = request.headers[CSRF_HEADER_NAME];
    const csrfHeaderValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (
      csrfCookie !== null &&
      csrfHeaderValue !== undefined &&
      csrfCookie.length > 0 &&
      timingSafeTextEqual(csrfCookie, csrfHeaderValue)
    ) {
      next();
      return;
    }

    sendError(response, 403, "FORBIDDEN", "CSRF token is missing or invalid.", {
      cookieName: CSRF_COOKIE_NAME,
      headerName: CSRF_HEADER_NAME,
    });
  };
}

function hasBearerAuthorization(request: Request): boolean {
  const authorizationHeader = request.headers.authorization;

  return (
    authorizationHeader !== undefined &&
    /^Bearer\s+.+$/iu.test(authorizationHeader.trim())
  );
}

function timingSafeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
