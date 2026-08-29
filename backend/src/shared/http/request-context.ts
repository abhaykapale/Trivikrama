import type { Request } from "express";

export interface RequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export function getRequestContext(request: Request): RequestContext {
  return {
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
  };
}

export function getClientIp(request: Request): string | null {
  return request.ip ?? request.socket.remoteAddress ?? null;
}

export function getUserAgent(request: Request): string | null {
  const value = request.headers["user-agent"];

  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
