import type { AuthRole } from "../domain/index.js";

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly orgId: string;
  readonly sessionId: string;
  readonly jwtId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: string;
  readonly tokenSource: "cookie" | "bearer";
}
