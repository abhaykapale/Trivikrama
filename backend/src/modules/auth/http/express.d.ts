import type { AuthenticatedPrincipal } from "./authenticated-principal.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedPrincipal;
    }
  }
}

export {};
