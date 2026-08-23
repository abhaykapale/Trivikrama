import type { Knex } from "knex";
import { BcryptPasswordService } from "../infrastructure/password/bcrypt-password.service.js";
import { JwtService } from "../infrastructure/token/jwt.service.js";
import { SystemClock } from "../infrastructure/time/system-clock.js";
import { UuidIdGenerator } from "../infrastructure/id/uuid-id-generator.js";
import { PostgresSessionValidator } from "../infrastructure/session/postgres-session-validator.js";
import { redactAuthSecrets } from "../infrastructure/redaction/auth-redaction.js";

export interface AuthInfrastructureDependencies {
  readonly passwordService: BcryptPasswordService;
  readonly jwtService: JwtService;
  readonly clock: SystemClock;
  readonly idGenerator: UuidIdGenerator;
  readonly sessionValidator: PostgresSessionValidator;
  readonly redactAuthSecrets: typeof redactAuthSecrets;
}

export interface BuildAuthInfrastructureDependenciesInput {
  readonly knex: Knex;
  readonly env?: NodeJS.ProcessEnv;
}

export function buildAuthInfrastructureDependencies(
  input: BuildAuthInfrastructureDependenciesInput,
): AuthInfrastructureDependencies {
  const env = input.env ?? process.env;
  const clock = new SystemClock();
  const bcryptRounds = parseRequiredInteger(env.BCRYPT_SALT_ROUNDS ?? "12", "BCRYPT_SALT_ROUNDS");

  if (bcryptRounds !== 12) {
    throw new Error("BCRYPT_SALT_ROUNDS must be 12 for BE-01B.");
  }

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required.");
  }

  return {
    clock,
    passwordService: new BcryptPasswordService(bcryptRounds),
    jwtService: new JwtService({
      secret: jwtSecret,
      issuer: env.JWT_ISSUER ?? "ai-siem",
      accessTokenExpirySeconds: parseDurationToSeconds(
        env.JWT_ACCESS_TOKEN_EXPIRY_SECONDS ?? env.JWT_ACCESS_TOKEN_EXPIRY ?? "1h",
      ),
      clock,
    }),
    idGenerator: new UuidIdGenerator(),
    sessionValidator: new PostgresSessionValidator(input.knex, clock),
    redactAuthSecrets,
  };
}

function parseRequiredInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer.`);
  }

  return parsed;
}

function parseDurationToSeconds(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = /^(\d+)(s|m|h|d)?$/.exec(normalized);

  if (!match) {
    throw new Error("JWT_ACCESS_TOKEN_EXPIRY must be a duration like 3600, 3600s, 60m, 1h, or 7d.");
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";

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
      throw new Error("Unsupported JWT_ACCESS_TOKEN_EXPIRY unit.");
  }
}
