import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../../../config/index.js";
import type {
  IJwtService,
  ISessionRepository,
  IUserRepository,
} from "../domain/index.js";
import { clearAuthCookie, parseAuthCookies } from "./auth-cookie.js";
import { sendError } from "./auth-http.errors.js";
import type { AuthenticatedPrincipal } from "./authenticated-principal.js";

export interface AuthenticateRequestDependencies {
  readonly jwtService: IJwtService;
  readonly sessionRepository: Pick<ISessionRepository, "findByJwtId">;
  readonly userRepository: Pick<IUserRepository, "findById">;
  readonly config: AppConfig;
}

export function authenticateRequest(
  dependencies: AuthenticateRequestDependencies,
) {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const extracted = extractToken(request, dependencies.config);

    if (extracted === null) {
      sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
      return;
    }

    try {
      const claims = await dependencies.jwtService.verify(extracted.token);
      const session = await dependencies.sessionRepository.findByJwtId(
        claims.jti,
      );

      if (
        session === null ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        if (extracted.source === "cookie") {
          clearAuthCookie(response, dependencies.config);
        }

        sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
        return;
      }

      const user = await dependencies.userRepository.findById(claims.sub);

      if (user === null || !user.isActive) {
        if (extracted.source === "cookie") {
          clearAuthCookie(response, dependencies.config);
        }

        sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
        return;
      }

      request.user = {
        userId: user.id,
        username: user.username,
        role: user.role,
        orgId: user.orgId,
        sessionId: session.id,
        jwtId: claims.jti,
        issuedAt: toIsoDateTime(claims.iat),
        expiresAt: session.expiresAt.toISOString(),
        issuer: claims.iss,
        tokenSource: extracted.source,
      } satisfies AuthenticatedPrincipal;

      next();
    } catch {
      if (extracted.source === "cookie") {
        clearAuthCookie(response, dependencies.config);
      }

      sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
    }
  };
}

export function requireAuthenticatedPrincipal(
  request: Request,
): AuthenticatedPrincipal {
  if (request.user === undefined) {
    throw new Error("Authenticated principal was not attached to the request.");
  }

  return request.user;
}

function extractToken(
  request: Request,
  config: AppConfig,
): { readonly token: string; readonly source: "cookie" | "bearer" } | null {
  const cookies = parseAuthCookies(request.headers.cookie, config);

  if (cookies.authToken !== null && cookies.authToken.length > 0) {
    return { token: cookies.authToken, source: "cookie" };
  }

  const authorizationHeader = request.headers.authorization;

  if (authorizationHeader === undefined) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorizationHeader.trim());

  if (match === null || match[1] === undefined || match[1].trim().length === 0) {
    return null;
  }

  return { token: match[1].trim(), source: "bearer" };
}

function toIsoDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
