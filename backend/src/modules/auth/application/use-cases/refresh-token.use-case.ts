import type {
  IClock,
  IJwtService,
  ISessionValidator,
  IUserRepository,
} from "../../domain/auth.contracts.js";
import type { JwtClaims, SessionValidationResult } from "../../domain/auth.types.js";
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
import { assertPositiveInteger, hasErrorCode, isRecord } from "../shared.js";

export interface RefreshTokenUseCaseOptions {
  readonly accessTokenTtlSeconds: number;
  readonly refreshWindowSeconds?: number;
}

type RefreshUserRepository = Pick<IUserRepository, "findById">;

export class RefreshTokenUseCase {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshWindowSeconds?: number;

  public constructor(
    private readonly jwtService: IJwtService,
    private readonly sessionValidator: ISessionValidator,
    private readonly userRepository: RefreshUserRepository,
    private readonly clock: IClock,
    options: RefreshTokenUseCaseOptions,
  ) {
    this.accessTokenTtlSeconds = assertPositiveInteger(
      options.accessTokenTtlSeconds,
      "accessTokenTtlSeconds",
    );

    this.refreshWindowSeconds =
      options.refreshWindowSeconds === undefined
        ? undefined
        : assertPositiveInteger(options.refreshWindowSeconds, "refreshWindowSeconds");
  }

  public async execute(
    input: RefreshTokenRequestDto,
  ): Promise<RefreshTokenResponseDto> {
    const currentClaims = await this.verifyToken(input.token);

    await this.validateSession(currentClaims.jti);

    const user = await this.userRepository.findById(currentClaims.sub);

    if (user === null) {
      throw new UserNotFoundError();
    }

    if (!isUserActive(user)) {
      throw new UserInactiveError();
    }

    this.assertRefreshWindow(currentClaims);

    const nowUnixSeconds = this.nowUnixSeconds();
    const expiresAtUnixSeconds = nowUnixSeconds + this.accessTokenTtlSeconds;

    const refreshedClaims: JwtClaims = {
      sub: currentClaims.sub,
      username: currentClaims.username,
      role: currentClaims.role,
      jti: currentClaims.jti,
      iat: nowUnixSeconds,
      exp: expiresAtUnixSeconds,
      iss: currentClaims.iss,
    };

    const token = await this.jwtService.sign(refreshedClaims);

    return {
      token,
      expiresAt: new Date(expiresAtUnixSeconds * 1000).toISOString(),
    };
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