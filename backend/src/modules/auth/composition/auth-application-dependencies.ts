import type { Knex } from "knex";

import config, { type AppConfig } from "../../../config/index.js";
import type { RelationalRepositories } from "../../../database/repositories/index.js";
import type {
  AuditLogRecord,
  CreateAuditLogInput,
  IAuditRepository,
  IClock,
  IIdGenerator,
  IJwtService,
  IPasswordService,
  ISessionValidator,
} from "../domain/auth.contracts.js";
import type { JwtClaims, SessionValidationResult } from "../domain/auth.types.js";
import {
  AuthService,
  type AuthServiceDependencies,
} from "../application/services/index.js";
import { AuthAuditService } from "../application/services/index.js";
import {
  GetCurrentUserUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshTokenUseCase,
} from "../application/use-cases/index.js";
import {
  BcryptPasswordService,
  JwtService,
  PostgresSessionValidator,
  SystemClock,
  UuidIdGenerator,
} from "../infrastructure/index.js";

export interface AuthApplicationRepositoryDependencies {
  readonly users: RelationalRepositories["users"];
  readonly sessions: RelationalRepositories["sessions"];
  readonly audit: RelationalRepositories["audit"];
}

export interface CreateAuthApplicationDependenciesInput {
  readonly knex: Knex;
  readonly repositories: AuthApplicationRepositoryDependencies;
  readonly appConfig?: AppConfig;
}

export interface AuthApplicationDependencies extends AuthServiceDependencies {
  readonly authService: AuthService;
  readonly authAuditService: AuthAuditService;
  readonly passwordService: IPasswordService;
  readonly jwtService: IJwtService;
  readonly clock: IClock;
  readonly idGenerator: IIdGenerator;
  readonly sessionValidator: ISessionValidator;
}

export function createAuthApplicationDependencies(
  input: CreateAuthApplicationDependenciesInput,
): AuthApplicationDependencies {
  const appConfig = input.appConfig ?? config;
  const clock = new SystemClock();
  const accessTokenTtlSeconds = parseDurationToSeconds(
    appConfig.jwt.accessTokenExpiry,
    "JWT_ACCESS_TOKEN_EXPIRY",
  );
  const refreshWindowSeconds = parseDurationToSeconds(
    appConfig.jwt.refreshWindow,
    "JWT_REFRESH_WINDOW",
  );

  const passwordService = new BcryptPasswordServiceAdapter(
    new BcryptPasswordService(appConfig.auth.bcryptRounds),
  );
  const jwtService = new JwtServiceAdapter(
    new JwtService({
      secret: appConfig.jwt.secret,
      issuer: appConfig.jwt.issuer,
      accessTokenExpirySeconds: accessTokenTtlSeconds,
      clock,
    }),
  );
  const idGenerator = new UuidIdGeneratorAdapter(new UuidIdGenerator());
  const sessionValidator = new PostgresSessionValidatorAdapter(
    new PostgresSessionValidator(input.knex, clock),
  );

  const authAuditRepository = new AuthAuditRepositoryAdapter(
    input.repositories.audit,
  );
  const authAuditService = new AuthAuditService(
    authAuditRepository,
    idGenerator,
  );

  const loginUseCase = new LoginUseCase(
    input.repositories.users,
    input.repositories.sessions,
    passwordService,
    jwtService,
    idGenerator,
    clock,
    authAuditService,
    {
      accessTokenTtlSeconds,
      lockoutAttempts: appConfig.auth.lockoutAttempts,
      lockoutDurationMinutes: appConfig.auth.lockoutMinutes,
    },
  );

  const logoutUseCase = new LogoutUseCase(
    input.repositories.sessions,
    authAuditService,
    clock,
  );

  const refreshTokenUseCase = new RefreshTokenUseCase(
    jwtService,
    sessionValidator,
    input.repositories.users,
    clock,
    {
      accessTokenTtlSeconds,
      refreshWindowSeconds,
    },
  );

  const getCurrentUserUseCase = new GetCurrentUserUseCase(
    input.repositories.users,
  );

  const authService = new AuthService({
    loginUseCase,
    logoutUseCase,
    refreshTokenUseCase,
    getCurrentUserUseCase,
  });

  return {
    authService,
    loginUseCase,
    logoutUseCase,
    refreshTokenUseCase,
    getCurrentUserUseCase,
    authAuditService,
    passwordService,
    jwtService,
    clock,
    idGenerator,
    sessionValidator,
  };
}

/**
 * Narrows the shared database audit repository to the authentication domain
 * port. The shared repository supports every platform audit action, while the
 * auth module intentionally exposes only authentication actions.
 */
class AuthAuditRepositoryAdapter implements IAuditRepository {
  public constructor(
    private readonly auditRepository: AuthApplicationRepositoryDependencies["audit"],
  ) {}

  public async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const record = await this.auditRepository.create(input);

    return {
      ...record,
      // The shared repository has a wider AuditAction return type. This record
      // was created from the auth-owned input, so retain that narrowed action.
      action: input.action,
    };
  }
}

class BcryptPasswordServiceAdapter implements IPasswordService {
  public constructor(private readonly service: BcryptPasswordService) {}

  public async verify(
    plainTextPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.service.verifyPassword(plainTextPassword, passwordHash);
  }

  public async hash(plainTextPassword: string): Promise<string> {
    return this.service.hashPassword(plainTextPassword);
  }
}

class JwtServiceAdapter implements IJwtService {
  public constructor(
    private readonly jwtService: {
      sign(claims: JwtClaims): Promise<string> | string;
      verify(token: string): Promise<JwtClaims> | JwtClaims;
    },
  ) {}

  public async sign(claims: JwtClaims): Promise<string> {
    return this.jwtService.sign(claims);
  }

  public async verify(token: string): Promise<JwtClaims> {
    return this.jwtService.verify(token);
  }
}

class UuidIdGeneratorAdapter implements IIdGenerator {
  public constructor(private readonly generator: UuidIdGenerator) {}

  public generate(): string {
    return this.generator.generateJwtId();
  }
}

class PostgresSessionValidatorAdapter implements ISessionValidator {
  public constructor(private readonly validator: PostgresSessionValidator) {}

  public async validate(jwtId: string): Promise<SessionValidationResult> {
    const result = await this.validator.validateSession(jwtId);

    if (!result.valid) {
      return {
        valid: false,
        session: null,
        reason: result.reason,
      };
    }

    return {
      valid: true,
      session: {
        jwtId: result.session.jwtId,
        userId: result.session.userId,
        expiresAt: result.session.expiresAt,
        revokedAt: null,
      },
      reason: null,
    };
  }
}

function parseDurationToSeconds(value: string, name: string): number {
  const normalized = value.trim().toLowerCase();
  const match = /^(\d+)(s|m|h|d)$/.exec(normalized);

  if (!match) {
    throw new Error(`${name} must be a duration like 30s, 5m, 1h, or 7d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`${name} must contain a positive integer amount.`);
  }

  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 24 * 60 * 60;
    default:
      throw new Error(`${name} contains an unsupported duration unit.`);
  }
}
