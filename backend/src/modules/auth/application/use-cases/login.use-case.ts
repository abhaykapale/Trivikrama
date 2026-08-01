import type {
  IClock,
  IIdGenerator,
  IJwtService,
  IPasswordService,
  ISessionRepository,
  IUserRepository,
} from "../../domain/auth.contracts.js";
import type {
  LoginRequestDto,
  LoginResponseDto,
  LoginResponseUserDto,
} from "../dto/index.js";
import {
  AccountLockedError,
  InvalidCredentialsError,
  UserInactiveError,
  UserNotFoundError,
} from "../errors/index.js";
import { AuthAuditService } from "../services/index.js";

import type { JwtClaims } from "../../domain/auth.types.js";
const DEFAULT_ORG_ID = "default";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_LOCKOUT_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_DURATION_MINUTES = 15;
const JWT_ISSUER = "ai-siem";



export interface LoginUseCaseOptions {
  readonly orgId?: string;
  readonly accessTokenTtlSeconds?: number;
  readonly lockoutAttempts?: number;
  readonly lockoutDurationMinutes?: number;
}

export type LoginUseCaseInput = LoginRequestDto;

type LoginUserRepository = Pick<IUserRepository, "findByUsername" | "update">;
type LoginSessionRepository = Pick<ISessionRepository, "create">;

interface LoginUserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: LoginResponseUserDto["role"];
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | string | null;
  readonly lastLoginAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly orgId?: string;
}

export class LoginUseCase {
  private readonly orgId: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly lockoutAttempts: number;
  private readonly lockoutDurationMinutes: number;

  public constructor(
    private readonly userRepository: LoginUserRepository,
    private readonly sessionRepository: LoginSessionRepository,
    private readonly passwordService: IPasswordService,
    private readonly jwtService: IJwtService,
    private readonly idGenerator: IIdGenerator,
    private readonly clock: IClock,
    private readonly authAuditService: AuthAuditService,
    options: LoginUseCaseOptions = {},
  ) {
    this.orgId = normalizeOrgId(options.orgId);
    this.accessTokenTtlSeconds = assertPositiveInteger(
      options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      "accessTokenTtlSeconds",
    );
    this.lockoutAttempts = assertPositiveInteger(
      options.lockoutAttempts ?? DEFAULT_LOCKOUT_ATTEMPTS,
      "lockoutAttempts",
    );
    this.lockoutDurationMinutes = assertPositiveInteger(
      options.lockoutDurationMinutes ?? DEFAULT_LOCKOUT_DURATION_MINUTES,
      "lockoutDurationMinutes",
    );
  }

  public async execute(input: LoginUseCaseInput): Promise<LoginResponseDto> {
    const username = normalizeUsername(input.username);
    const user = await this.findUser(username);

    if (user === null) {
      await this.authAuditService.recordLoginFailure({
        username,
        reason: "user_not_found",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: this.orgId,
      });

      throw new InvalidCredentialsError();
    }

    if (!user.isActive) {
      await this.authAuditService.recordLoginFailure({
        username: user.username,
        reason: "user_inactive",
        userId: user.id,
        userRole: user.role,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: getUserOrgId(user, this.orgId),
      });

      throw new UserInactiveError();
    }

    const activeLockUntil = getActiveLockUntil(
      user.lockedUntil,
      this.clock.now(),
    );

    if (activeLockUntil !== null) {
      const lockedUntilIso = activeLockUntil.toISOString();

      await this.authAuditService.recordAccountLocked({
        username: user.username,
        userId: user.id,
        userRole: user.role,
        failedLoginCount: user.failedLoginCount,
        lockedUntil: lockedUntilIso,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: getUserOrgId(user, this.orgId),
      });

      throw new AccountLockedError(lockedUntilIso);
    }

    const passwordMatches = await this.passwordService.verify(
      input.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      await this.handleInvalidPassword(user, input);
      return unreachableLoginResponse();
    }

    return this.handleSuccessfulLogin(user, input);
  }

  private async findUser(username: string): Promise<LoginUserRecord | null> {
    const user = await this.userRepository.findByUsername(username, this.orgId);

    if (user === null) {
      return null;
    }

    return user as LoginUserRecord;
  }

  private async handleInvalidPassword(
    user: LoginUserRecord,
    input: LoginUseCaseInput,
  ): Promise<never> {
    const now = this.clock.now();
    const nextFailedLoginCount = user.failedLoginCount + 1;
    const shouldLock = nextFailedLoginCount >= this.lockoutAttempts;
    const lockedUntil = shouldLock
      ? addMinutes(now, this.lockoutDurationMinutes)
      : null;

    await this.userRepository.update(user.id, {
      failedLoginCount: nextFailedLoginCount,
      lockedUntil,
    });

    if (shouldLock && lockedUntil !== null) {
      const lockedUntilIso = lockedUntil.toISOString();

      await this.authAuditService.recordAccountLocked({
        username: user.username,
        userId: user.id,
        userRole: user.role,
        failedLoginCount: nextFailedLoginCount,
        lockedUntil: lockedUntilIso,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        orgId: getUserOrgId(user, this.orgId),
      });

      throw new AccountLockedError(lockedUntilIso);
    }

    await this.authAuditService.recordLoginFailure({
      username: user.username,
      reason: "invalid_credentials",
      userId: user.id,
      userRole: user.role,
      failedLoginCount: nextFailedLoginCount,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      orgId: getUserOrgId(user, this.orgId),
    });

    throw new InvalidCredentialsError();
  }

  private async handleSuccessfulLogin(
    user: LoginUserRecord,
    input: LoginUseCaseInput,
  ): Promise<LoginResponseDto> {
    const now: Date = this.clock.now();
    const jwtId = this.idGenerator.generate();
    const expiresAt = addSeconds(now, this.accessTokenTtlSeconds);

    const updatedUser = await this.userRepository.update(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
    });

    if (updatedUser === null) {
      throw new UserNotFoundError();
    }

    const safeUser = mapLoginResponseUser(updatedUser);

    await this.sessionRepository.create({
      userId: user.id,
      jwtId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    });

    const claims: JwtClaims = {
      sub: user.id,
      username: user.username,
      role: user.role,
      jti: jwtId,
      iat: toUnixSeconds(now),
      exp: toUnixSeconds(expiresAt),
      iss: JWT_ISSUER,
    };

    const token = await this.jwtService.sign(claims);

    await this.authAuditService.recordLoginSuccess({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      orgId: getUserOrgId(user, this.orgId),
    });

    return {
      token,
      user: safeUser,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

function mapLoginResponseUser(user: {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: LoginResponseUserDto["role"];
  readonly displayName: string | null;
  readonly lastLoginAt: Date | string | null;
}): LoginResponseUserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    lastLoginAt: toNullableIsoDateTimeString(user.lastLoginAt),
  };
}

function normalizeUsername(username: string): string {
  const normalized = username.trim();

  if (normalized.length === 0) {
    throw new InvalidCredentialsError();
  }

  return normalized;
}

function normalizeOrgId(orgId: string | undefined): string {
  const normalized = orgId?.trim();

  return normalized && normalized.length > 0 ? normalized : DEFAULT_ORG_ID;
}

function getUserOrgId(user: LoginUserRecord, fallbackOrgId: string): string {
  const normalized = user.orgId?.trim();

  return normalized && normalized.length > 0 ? normalized : fallbackOrgId;
}

function getActiveLockUntil(
  lockedUntil: Date | string | null,
  now: Date,
): Date | null {
  if (lockedUntil === null) {
    return null;
  }

  const lockDate = toDate(lockedUntil);

  return lockDate.getTime() > now.getTime() ? lockDate : null;
}

function toNullableIsoDateTimeString(
  value: Date | string | null,
): string | null {
  if (value === null) {
    return null;
  }

  return toDate(value).toISOString();
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value.");
  }

  return date;
}

function addMinutes(date: Date, minutes: number): Date {
  return addSeconds(date, minutes * 60);
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function assertPositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function unreachableLoginResponse(): never {
  throw new Error("Unreachable login response path.");
}
