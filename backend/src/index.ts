export {
  authenticateRequest,
  requireAuthenticatedPrincipal,
} from "./modules/auth/http/auth.middleware.js";
export type { AuthenticateRequestDependencies } from "./modules/auth/http/auth.middleware.js";
export { createAuthRouter } from "./modules/auth/http/auth.routes.js";
export type { CreateAuthRouterDependencies } from "./modules/auth/http/auth.routes.js";
export type { Permission } from "./modules/auth/http/permissions.js";
export {
  requirePermission,
  requireRole,
} from "./modules/auth/http/rbac.middleware.js";
