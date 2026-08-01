export type {
  AuthUserDto,
  GetCurrentUserRequestDto,
  IsoDateTimeString,
  LoginRequestDto,
  LoginResponseDto,
  LoginResponseUserDto,
  LogoutRequestDto,
  LogoutResponseDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  SessionContextDto,
} from "./dto/index.js";

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
} from "./errors/index.js";

export type {
  AuthApplicationErrorCode,
  AuthApplicationErrorDetails,
} from "./errors/index.js";

export {
  AuthAuditService,
  AuthService,
} from "./services/index.js";

export type {
  AuthAuditActorDto,
  AuthAuditClientContextDto,
  AuthAuditLoginFailureReason,
  AuthAuditRefreshFailureReason,
  AuthServiceDependencies,
  RecordAccountLockedInput,
  RecordLoginFailureInput,
  RecordLoginSuccessInput,
  RecordLogoutInput,
  RecordRefreshFailureInput,
} from "./services/index.js";

export {
  GetCurrentUserUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshTokenUseCase,
} from "./use-cases/index.js";

export type {
  GetCurrentUserUseCaseInput,
  LoginUseCaseInput,
  LoginUseCaseOptions,
  LogoutUseCaseInput,
  RefreshTokenUseCaseOptions,
} from "./use-cases/index.js";
