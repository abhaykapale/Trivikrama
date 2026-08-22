export { createAuthRouter } from "./auth.routes.js";
export type { CreateAuthRouterDependencies } from "./auth.routes.js";
export {
  authenticateRequest,
  requireAuthenticatedPrincipal,
} from "./auth.middleware.js";
export type { AuthenticateRequestDependencies } from "./auth.middleware.js";
export { requirePermission, requireRole } from "./rbac.middleware.js";
export type { Permission } from "./permissions.js";
