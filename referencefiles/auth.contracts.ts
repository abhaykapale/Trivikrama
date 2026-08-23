import type {
  AuthSession,
  JwtClaims,
  SessionValidationResult,
} from "./auth.types.js";

export type {
  IAuditRepository,
} from "../../../database/repositories/audit/index.js";
export type {
  ISessionRepository,
} from "../../../database/repositories/sessions/index.js";
export type {
  IUserRepository,
} from "../../../database/repositories/users/index.js";
export type {
  IUnitOfWork,
} from "../../../database/transactions/index.js";

export interface IPasswordService {
  verify(plainTextPassword: string, passwordHash: string): Promise<boolean>;
  hash(plainTextPassword: string): Promise<string>;
}

export interface IJwtService {
  sign(claims: JwtClaims): Promise<string>;
  verify(token: string): Promise<JwtClaims>;
}

/** The generic token port name is retained as an alias to the JWT contract. */
export type ITokenService = IJwtService;

export interface ISessionCache {
  get(jwtId: string): Promise<AuthSession | null>;
  set(session: AuthSession, ttlSeconds: number): Promise<void>;
  delete(jwtId: string): Promise<void>;
}

export interface IClock {
  now(): Date;
}

export interface IIdGenerator {
  generate(): string;
}

export interface ISessionValidator {
  validate(jwtId: string): Promise<SessionValidationResult>;
}

/** Existing contract names retained as aliases for later implementations. */
export type PasswordVerifier = Pick<IPasswordService, "verify">;
export type PasswordHasher = Pick<IPasswordService, "hash">;
export type TokenSigner = Pick<IJwtService, "sign">;
export type TokenVerifier = Pick<IJwtService, "verify">;
export type SessionValidator = ISessionValidator;
