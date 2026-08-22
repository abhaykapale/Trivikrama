import type { NextFunction, Request, Response } from "express";
import type { AuthRole } from "../domain/index.js";
import { sendError } from "./auth-http.errors.js";
import type { Permission } from "./permissions.js";
import { roleHasPermission } from "./permissions.js";

export function requireRole(...roles: readonly AuthRole[]) {
  const allowedRoles = new Set(roles);

  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.user === undefined) {
      sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
      return;
    }

    if (!allowedRoles.has(request.user.role)) {
      sendError(response, 403, "FORBIDDEN", "Insufficient permissions.");
      return;
    }

    next();
  };
}

export function requirePermission(permission: Permission) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.user === undefined) {
      sendError(response, 401, "UNAUTHORIZED", "Authentication required.");
      return;
    }

    if (!roleHasPermission(request.user.role, permission)) {
      sendError(response, 403, "FORBIDDEN", "Insufficient permissions.");
      return;
    }

    next();
  };
}
