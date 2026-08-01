import { AUTH_ERROR_CODES } from "../../domain/auth.errors.js";

/**
 * Application-layer error codes derived from the domain's shared
 * AUTH_ERROR_CODES to prevent drift between hierarchies.
 */
export const AUTH_APPLICATION_ERROR_CODES = {
  INVALID_CREDENTIALS: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
  ACCOUNT_LOCKED: AUTH_ERROR_CODES.ACCOUNT_LOCKED,
  SESSION_EXPIRED: AUTH_ERROR_CODES.SESSION_EXPIRED,
  SESSION_REVOKED: AUTH_ERROR_CODES.SESSION_REVOKED,
  TOKEN_INVALID: AUTH_ERROR_CODES.TOKEN_INVALID,
  USER_INACTIVE: AUTH_ERROR_CODES.USER_INACTIVE,
  USER_NOT_FOUND: AUTH_ERROR_CODES.USER_NOT_FOUND,
} as const;

export type AuthApplicationErrorCode =
  (typeof AUTH_APPLICATION_ERROR_CODES)[keyof typeof AUTH_APPLICATION_ERROR_CODES];

export interface AuthApplicationErrorDetails {
  readonly [key: string]: unknown;
}

export class AuthApplicationError extends Error {
  public readonly code: AuthApplicationErrorCode;
  public readonly details?: AuthApplicationErrorDetails;

  public constructor(
    code: AuthApplicationErrorCode,
    message: string,
    details?: AuthApplicationErrorDetails,
  ) {
    super(message);

    this.name = new.target.name;
    this.code = code;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidCredentialsError extends AuthApplicationError {
  public constructor() {
    super(
      AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
      "Invalid username or password.",
    );
  }
}

export class AccountLockedError extends AuthApplicationError {
  public constructor(lockedUntil: string) {
    super(
      AUTH_APPLICATION_ERROR_CODES.ACCOUNT_LOCKED,
      `Account locked due to too many failed attempts. Try again after ${lockedUntil}.`,
      { lockedUntil },
    );
  }
}

export class SessionExpiredError extends AuthApplicationError {
  public constructor() {
    super(
      AUTH_APPLICATION_ERROR_CODES.SESSION_EXPIRED,
      "Session expired. Please login again.",
    );
  }
}

export class SessionRevokedError extends AuthApplicationError {
  public constructor() {
    super(
      AUTH_APPLICATION_ERROR_CODES.SESSION_REVOKED,
      "Session has been revoked. Please login again.",
    );
  }
}

export class TokenInvalidError extends AuthApplicationError {
  public constructor() {
    super(
      AUTH_APPLICATION_ERROR_CODES.TOKEN_INVALID,
      "Authentication token is invalid.",
    );
  }
}

export class UserInactiveError extends AuthApplicationError {
  public constructor() {
    super(
      AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE,
      "User account is inactive.",
    );
  }
}

export class UserNotFoundError extends AuthApplicationError {
  public constructor() {
    super(AUTH_APPLICATION_ERROR_CODES.USER_NOT_FOUND, "User was not found.");
  }
}

export function isAuthApplicationError(
  error: unknown,
): error is AuthApplicationError {
  return error instanceof AuthApplicationError;
}
