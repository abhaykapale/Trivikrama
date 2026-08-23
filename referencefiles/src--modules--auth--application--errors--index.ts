export {
  AccountLockedError,
  AuthApplicationError,
  AUTH_APPLICATION_ERROR_CODES,
  InvalidCredentialsError,
  SessionExpiredError,
  SessionRevokedError,
  TokenInvalidError,
  UserInactiveError,
  UserNotFoundError,
  isAuthApplicationError,
} from "./auth-application.error.js";

export type {
  AuthApplicationErrorCode,
  AuthApplicationErrorDetails,
} from "./auth-application.error.js";
