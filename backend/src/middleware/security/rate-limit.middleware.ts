import type { NextFunction, Request, Response } from "express";
import type { RedisClient } from "../../database/index.js";
import { sendError } from "../../modules/auth/http/auth-http.errors.js";

export interface RedisFixedWindowRateLimitOptions {
  readonly redisClient: RedisClient;
  readonly keyPrefix: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export function createRedisFixedWindowRateLimit(
  options: RedisFixedWindowRateLimitOptions,
) {
  assertPositiveInteger(options.limit, "limit");
  assertPositiveInteger(options.windowSeconds, "windowSeconds");

  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = `${options.keyPrefix}:${getClientIp(request)}`;

    try {
      const count = await options.redisClient.incr(key);

      if (count === 1) {
        await options.redisClient.expire(key, options.windowSeconds);
      }

      if (count > options.limit) {
        response.setHeader("Retry-After", String(options.windowSeconds));
        sendError(
          response,
          429,
          "RATE_LIMITED",
          "Too many authentication attempts. Please try again later.",
        );
        return;
      }

      next();
    } catch {
      sendError(
        response,
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Authentication rate limiter is unavailable.",
      );
    }
  };
}

function getClientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Rate limit ${fieldName} must be a positive integer.`);
  }
}
