import type {
  IClock,
  IIdGenerator,
  IJwtService,
  ISessionRepository,
  ISessionValidator,
  IUserRepository,
} from "../../domain/auth.contracts.js";
import type {
  AuthRole,
  JwtClaims,
  SessionValidationResult,
} from "../../domain/auth.types.js";
import type {
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
} from "../dto/index.js";
import {
  AuthApplicationError,
  AUTH_APPLICATION_ERROR_CODES,
  SessionExpiredError,
  SessionRevokedError,
  TokenInvalidError,
  UserInactiveError,
  UserNotFoundError,
} from "../errors/index.js";
import { AuthAuditService } from "../services/index.js";
import { assertPositiveInteger, hasErrorCode, isRecord } from "../shared.js";

export interface RefreshTokenUseCaseOptions {
  readonly accessTokenTtlSeconds: number;
  readonly refreshWindowSeconds?: number;
  readonly maxSessionDurationSeconds?: number;
}

type RefreshUserRepository = Pick<IUserRepository, "findById">;
type RefreshSessionRepository = Pick<
  ISessionRepository,
  "findByJwtId" | "rotateJwtId"
>;

export interface RefreshTokenUseCaseDependencies {
  readonly sessionRepository?: RefreshSessionRepository;
  readonly idGenerator?: IIdGenerator;
  readonly authAuditService?: AuthAuditService;
}

export class RefreshTokenUseCase {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshWindowSeconds?: number;
  private readonly maxSessionDurationSeconds?: number;
  private readonly sessionRepository?: RefreshSessionRepository;
  private readonly idGenerator?: IIdGenerator;
  private readonly authAuditService?: AuthAuditService;

  public constructor(
    private readonly jwtService: IJwtService,
    private readonly sessionValidator: ISessionValidator,
    private readonly userRepository: RefreshUserRepository,
    private readonly clock: IClock,
    options: RefreshTokenUseCaseOptions,
    dependencies: RefreshTokenUseCaseDependencies = {},
  ) {
    this.accessTokenTtlSeconds = assertPositiveInteger(
      options.accessTokenTtlSeconds,
      "accessTokenTtlSeconds",
    );

    this.refreshWindowSeconds =
      options.refreshWindowSeconds === undefined
        ? undefined
        : assertPositiveInteger(
            options.refreshWindowSeconds,
            "refreshWindowSeconds",
          );
    this.maxSessionDurationSeconds =
      options.maxSessionDurationSeconds === undefined
        ? undefined
        : assertPositiveInteger(
            options.maxSessionDurationSeconds,
            "maxSessionDurationSeconds",
          );
    this.sessionRepository = dependencies.sessionRepository;
    this.idGenerator = dependencies.idGenerator;
    this.authAuditService = dependencies.authAuditService;
  }

  public async execute(
    input: RefreshTokenRequestDto,
  ): Promise<RefreshTokenResponseDto> {
    let currentClaims: JwtClaims | null = null;
    let auditUser: AuditUser | null = null;

    try {
      currentClaims = await this.verifyToken(input.token);

      await this.validateSession(currentClaims.jti);

      const user = await this.userRepository.findById(currentClaims.sub);

      if (user === null) {
        throw new UserNotFoundError();
      }

      if (!isUserActive(user)) {
        throw new UserInactiveError();
      }

      auditUser = toAuditUser(user, currentClaims);
      this.assertRefreshWindow(currentClaims);

      const now = this.clock.now();
      const nowUnixSeconds = Math.floor(now.getTime() / 1000);
      const newJwtId = this.idGenerator?.generate() ?? currentClaims.jti;
      const expiresAt = await this.calculateRefreshExpiry(
        currentClaims.jti,
        now,
      );
      const expiresAtUnixSeconds = Math.floor(expiresAt.getTime() / 1000);

      if (newJwtId !== currentClaims.jti) {
        await this.rotateSessionJwtId(
          currentClaims.jti,
          newJwtId,
          now,
          expiresAt,
        );
      }

      const refreshedClaims: JwtClaims = {
        sub: currentClaims.sub,
        username: currentClaims.username,
        role: currentClaims.role,
        jti: newJwtId,
        iat: nowUnixSeconds,
        exp: expiresAtUnixSeconds,
        iss: currentClaims.iss,
      };

      const token = await this.jwtService.sign(refreshedClaims);

      await this.authAuditService?.recordRefreshSuccess({
        user: auditUser,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: getAuditOrgId(user),
      });

      return {
        token,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error: unknown) {
      await this.authAuditService?.recordRefreshFailure({
        reason: mapRefreshFailureReason(error),
        user: auditUser,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: currentClaims === null ? undefined : getClaimsOrgFallback(),
      });

      throw error;
    }
  }

  private async verifyToken(token: string): Promise<JwtClaims> {
    try {
      return await this.jwtService.verify(token);
    } catch (error: unknown) {
      if (hasErrorCode(error, "TOKEN_EXPIRED")) {
        throw new SessionExpiredError();
      }

      throw new TokenInvalidError();
    }
  }

  private async validateSession(jwtId: string): Promise<void> {
    const validation = await this.sessionValidator.validate(jwtId);

    if (validation.valid) {
      return;
    }

    throw mapSessionValidationFailure(validation);
  }

  private assertRefreshWindow(claims: JwtClaims): void {
    if (this.refreshWindowSeconds === undefined) {
      return;
    }

    const secondsUntilExpiry = claims.exp - this.nowUnixSeconds();

    if (secondsUntilExpiry <= this.refreshWindowSeconds) {
      return;
    }

    throw new AuthApplicationError(
      AUTH_APPLICATION_ERROR_CODES.TOKEN_INVALID,
      "Token is not eligible for refresh yet.",
      {
        secondsUntilExpiry,
        refreshWindowSeconds: this.refreshWindowSeconds,
      },
    );
  }

  private nowUnixSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  private async calculateRefreshExpiry(
    currentJwtId: string,
    now: Date,
  ): Promise<Date> {
    const requestedExpiry = addSeconds(now, this.accessTokenTtlSeconds);

    if (
      this.maxSessionDurationSeconds === undefined ||
      this.sessionRepository === undefined
    ) {
      return requestedExpiry;
    }

    const currentSession =
      await this.sessionRepository.findByJwtId(currentJwtId);

    if (currentSession === null) {
      throw new SessionExpiredError();
    }

    const maxSessionExpiry = addSeconds(
      currentSession.createdAt,
      this.maxSessionDurationSeconds,
    );
    const expiresAt =
      requestedExpiry.getTime() <= maxSessionExpiry.getTime()
        ? requestedExpiry
        : maxSessionExpiry;

    if (expiresAt.getTime() <= now.getTime()) {
      throw new SessionExpiredError();
    }

    return expiresAt;
  }

  private async rotateSessionJwtId(
    currentJwtId: string,
    newJwtId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    if (this.sessionRepository === undefined) {
      return;
    }

    const rotatedSession = await this.sessionRepository.rotateJwtId(
      currentJwtId,
      newJwtId,
      now,
      expiresAt,
    );

    if (rotatedSession === null) {
      throw new SessionExpiredError();
    }
  }
}

function mapSessionValidationFailure(
  validation: Exclude<SessionValidationResult, { readonly valid: true }>,
): AuthApplicationError {
  switch (validation.reason) {
    case "revoked":
      return new SessionRevokedError();

    case "expired":
    case "not_found":
      return new SessionExpiredError();

    default:
      return exhaustiveSessionFailure(validation.reason);
  }
}

function exhaustiveSessionFailure(reason: never): AuthApplicationError {
  return new AuthApplicationError(
    AUTH_APPLICATION_ERROR_CODES.SESSION_EXPIRED,
    "Session expired. Please login again.",
    { reason },
  );
}

function isUserActive(user: unknown): boolean {
  if (!isRecord(user)) {
    return false;
  }

  const isActive = user.isActive ?? user.is_active;

  return isActive !== false;
}

interface AuditUser {
  readonly id: string;
  readonly username: string;
  readonly role: AuthRole;
}

function toAuditUser(user: unknown, claims: JwtClaims): AuditUser {
  if (!isRecord(user)) {
    return {
      id: claims.sub,
      username: claims.username,
      role: claims.role,
    };
  }

  return {
    id: typeof user.id === "string" ? user.id : claims.sub,
    username:
      typeof user.username === "string" ? user.username : claims.username,
    role: isAuthRole(user.role) ? user.role : claims.role,
  };
}

function getAuditOrgId(user: unknown): string | undefined {
  if (!isRecord(user)) {
    return undefined;
  }

  return typeof user.orgId === "string" ? user.orgId : undefined;
}

function getClaimsOrgFallback(): undefined {
  return undefined;
}

function mapRefreshFailureReason(
  error: unknown,
):
  | "session_expired"
  | "session_revoked"
  | "token_invalid"
  | "user_inactive"
  | "user_not_found" {
  if (
    error instanceof AuthApplicationError &&
    error.code === AUTH_APPLICATION_ERROR_CODES.SESSION_REVOKED
  ) {
    return "session_revoked";
  }

  if (
    error instanceof AuthApplicationError &&
    error.code === AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE
  ) {
    return "user_inactive";
  }

  if (
    error instanceof AuthApplicationError &&
    error.code === AUTH_APPLICATION_ERROR_CODES.USER_NOT_FOUND
  ) {
    return "user_not_found";
  }

  if (
    error instanceof AuthApplicationError &&
    error.code === AUTH_APPLICATION_ERROR_CODES.TOKEN_INVALID
  ) {
    return "token_invalid";
  }

  return "session_expired";
}

function isAuthRole(value: unknown): value is AuthRole {
  return (
    value === "admin" ||
    value === "security_engineer" ||
    value === "soc_analyst"
  );
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
