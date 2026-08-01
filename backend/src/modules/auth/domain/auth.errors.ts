/**
 * Canonical error codes shared between the domain and application error
 * hierarchies.  Both layers reference these values so they stay in sync.
 */
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  INVALID_TOKEN: "INVALID_TOKEN",
  EXPIRED_TOKEN: "EXPIRED_TOKEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  INACTIVE_USER: "INACTIVE_USER",
  FORBIDDEN: "FORBIDDEN",
  TOKEN_INVALID: "TOKEN_INVALID",
  USER_INACTIVE: "USER_INACTIVE",
  USER_NOT_FOUND: "USER_NOT_FOUND",
} as const;

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "INACTIVE_USER"
  | "FORBIDDEN"
  | "TOKEN_INVALID"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND";

export abstract class AuthError extends Error {
  protected constructor(
    message: string,
    public readonly code: AuthErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCredentialsError extends AuthError {
  public constructor() {
    super("Invalid username or password", "INVALID_CREDENTIALS");
  }
}

export class AccountLockedError extends AuthError {
  public constructor(public readonly lockedUntil: Date) {
    super(
      `Account locked due to too many failed attempts. Try again after ${lockedUntil.toISOString()}`,
      "ACCOUNT_LOCKED",
    );
  }
}

export class InvalidTokenError extends AuthError {
  public constructor() {
    super("Authentication token is invalid.", "INVALID_TOKEN");
  }
}

export class ExpiredTokenError extends AuthError {
  public constructor() {
    super("Authentication token has expired.", "EXPIRED_TOKEN");
  }
}

export class SessionExpiredError extends AuthError {
  public constructor() {
    super("Session expired. Please login again", "SESSION_EXPIRED");
  }
}

export class SessionRevokedError extends AuthError {
  public constructor() {
    super("Session has been revoked.", "SESSION_REVOKED");
  }
}

export class InactiveUserError extends AuthError {
  public constructor() {
    super("User account is inactive.", "INACTIVE_USER");
  }
}

export class ForbiddenError extends AuthError {
  public constructor(message = "You do not have permission to perform this action") {
    super(message, "FORBIDDEN");
  }
}
