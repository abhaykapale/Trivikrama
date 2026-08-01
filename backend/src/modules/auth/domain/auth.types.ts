/**
 * Auth domain role type.
 *
 * Defined independently of the database layer so the domain owns its own
 * vocabulary.  The values intentionally match the database `UserRole` union
 * so that database implementations satisfy the domain contract via structural
 * typing — no adapter required.
 */
export type AuthRole = "admin" | "security_engineer" | "soc_analyst";

export interface AuthRequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface LoginCommand {
  readonly username: string;
  readonly password: string;
  readonly orgId: string;
  readonly context: AuthRequestContext;
}

export interface RefreshCommand {
  readonly token: string;
  readonly context: AuthRequestContext;
}

export interface LogoutCommand {
  readonly token: string;
  readonly context: AuthRequestContext;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: AuthRole;
  readonly displayName: string | null;
  readonly orgId: string;
}

export interface AuthPrincipal {
  readonly userId: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly orgId: string;
  readonly jwtId: string;
}

export interface AuthSession {
  readonly jwtId: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface JwtClaims {
  readonly sub: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

export type SessionValidationFailureReason =
  | "not_found"
  | "expired"
  | "revoked";

export type SessionValidationResult =
  | {
      readonly valid: true;
      readonly session: AuthSession;
      readonly reason: null;
    }
  | {
      readonly valid: false;
      readonly session: AuthSession | null;
      readonly reason: SessionValidationFailureReason;
    };
