import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import type { RedisClient } from "../../../database/index.js";
import type { AuthService } from "../application/index.js";
import type {
  IJwtService,
  ISessionRepository,
  IUserRepository,
} from "../domain/index.js";
import type { AppConfig } from "../../../config/index.js";
import {
  clearAuthCookie,
  setAuthCookie,
  setCsrfCookie,
} from "./auth-cookie.js";
import {
  authenticateRequest,
  requireAuthenticatedPrincipal,
} from "./auth.middleware.js";
import {
  sendAuthApplicationError,
  sendError,
} from "./auth-http.errors.js";
import { loginRequestSchema } from "./auth.schemas.js";
import { createRedisFixedWindowRateLimit } from "../../../middleware/security/rate-limit.middleware.js";

export interface CreateAuthRouterDependencies {
  readonly authService: AuthService;
  readonly jwtService: IJwtService;
  readonly sessionRepository: Pick<ISessionRepository, "findByJwtId">;
  readonly userRepository: Pick<IUserRepository, "findById">;
  readonly redisClient: RedisClient;
  readonly config: AppConfig;
}

export function createAuthRouter(
  dependencies: CreateAuthRouterDependencies,
): Router {
  const router = Router();
  const authenticate = authenticateRequest({
    jwtService: dependencies.jwtService,
    sessionRepository: dependencies.sessionRepository,
    userRepository: dependencies.userRepository,
    config: dependencies.config,
  });
  const loginRateLimit = createRedisFixedWindowRateLimit({
    redisClient: dependencies.redisClient,
    keyPrefix: "rl:auth",
    limit: dependencies.config.auth.rateLimitPerMinute,
    windowSeconds: 60,
  });

  router.post("/login", loginRateLimit, async (request, response) => {
    await handleLogin(request, response, dependencies);
  });

  router.post("/logout", authenticate, async (request, response) => {
    await handleLogout(request, response, dependencies);
  });

  router.post("/refresh", authenticate, async (request, response) => {
    await handleRefresh(request, response, dependencies);
  });

  router.get("/me", authenticate, async (request, response) => {
    await handleMe(request, response, dependencies);
  });

  return router;
}

async function handleLogin(
  request: Request,
  response: Response,
  dependencies: CreateAuthRouterDependencies,
): Promise<void> {
  try {
    const body = loginRequestSchema.parse(request.body);
    const result = await dependencies.authService.login({
      username: body.username,
      password: body.password,
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    setAuthCookie(
      response,
      result.token,
      dependencies.config,
      new Date(result.expiresAt),
    );
    setCsrfCookie(response, generateCsrfToken(), dependencies.config);

    response.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      sendError(response, 400, "VALIDATION_ERROR", "Invalid request body.", {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    sendAuthApplicationError(response, error);
  }
}

async function handleLogout(
  request: Request,
  response: Response,
  dependencies: CreateAuthRouterDependencies,
): Promise<void> {
  try {
    const principal = requireAuthenticatedPrincipal(request);
    const result = await dependencies.authService.logout({
      session: {
        userId: principal.userId,
        username: principal.username,
        role: principal.role,
        jwtId: principal.jwtId,
        issuedAt: principal.issuedAt,
        expiresAt: principal.expiresAt,
        issuer: principal.issuer,
        orgId: principal.orgId,
      },
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    clearAuthCookie(response, dependencies.config);
    response.status(200).json(result);
  } catch (error: unknown) {
    clearAuthCookie(response, dependencies.config);
    sendAuthApplicationError(response, error);
  }
}

async function handleRefresh(
  request: Request,
  response: Response,
  dependencies: CreateAuthRouterDependencies,
): Promise<void> {
  try {
    const token = extractRefreshToken(request, dependencies.config);

    if (token === null) {
      clearAuthCookie(response, dependencies.config);
      sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
      return;
    }

    const result = await dependencies.authService.refreshToken({
      token,
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    setAuthCookie(
      response,
      result.token,
      dependencies.config,
      new Date(result.expiresAt),
    );
    setCsrfCookie(response, generateCsrfToken(), dependencies.config);

    response.status(200).json(result);
  } catch (error: unknown) {
    clearAuthCookie(response, dependencies.config);
    sendAuthApplicationError(response, error);
  }
}

async function handleMe(
  request: Request,
  response: Response,
  dependencies: CreateAuthRouterDependencies,
): Promise<void> {
  try {
    const principal = requireAuthenticatedPrincipal(request);
    const user = await dependencies.authService.getCurrentUser({
      userId: principal.userId,
    });

    response.status(200).json({ user });
  } catch (error: unknown) {
    sendAuthApplicationError(response, error);
  }
}

function extractRefreshToken(
  request: Request,
  config: AppConfig,
): string | null {
  const cookieHeader = request.headers.cookie;
  const cookieName = config.jwt.cookie.name;
  const tokenFromCookie = cookieHeader
    ?.split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

  if (tokenFromCookie !== undefined && tokenFromCookie.length > 0) {
    return decodeURIComponent(tokenFromCookie);
  }

  const authorizationHeader = request.headers.authorization;

  if (authorizationHeader === undefined) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorizationHeader.trim());

  return match?.[1]?.trim() ?? null;
}

function getClientIp(request: Request): string | null {
  return request.ip ?? request.socket.remoteAddress ?? null;
}

function getUserAgent(request: Request): string | null {
  return request.headers["user-agent"] ?? null;
}

function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}
