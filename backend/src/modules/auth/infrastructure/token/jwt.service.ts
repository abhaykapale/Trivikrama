import * as jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";

export type AuthRole = "admin" | "security_engineer" | "soc_analyst";

export interface AuthJwtClaims {
  readonly sub: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
}

export interface SignAuthTokenInput {
  readonly userId: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly jwtId: string;
  readonly expiresInSeconds?: number;
}

export interface SignAuthTokenResult {
  readonly token: string;
  readonly claims: AuthJwtClaims;
  readonly expiresAt: Date;
}

export type JwtVerificationFailureCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_WRONG_ISSUER"
  | "TOKEN_INVALID";

export class JwtVerificationError extends Error {
  public constructor(
    public readonly code: JwtVerificationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

interface ClockLike {
  nowUnixSeconds(): number;
}

export interface JwtServiceOptions {
  readonly secret: string;
  readonly issuer?: string;
  readonly accessTokenExpirySeconds?: number;
  readonly clock: ClockLike;
}

const DEFAULT_ISSUER = "ai-siem";
const DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS = 60 * 60;
const MIN_SECRET_LENGTH = 64;

export class JwtService {
  private readonly secret: string;
  private readonly issuer: string;
  private readonly accessTokenExpirySeconds: number;
  private readonly clock: ClockLike;

  public constructor(options: JwtServiceOptions) {
    if (!options.secret || options.secret.length < MIN_SECRET_LENGTH) {
      throw new Error("JWT_SECRET must be at least 64 characters.");
    }

    if (
      !Number.isInteger(options.accessTokenExpirySeconds ?? DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS) ||
      (options.accessTokenExpirySeconds ?? DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS) <= 0
    ) {
      throw new Error("JWT access token expiry must be a positive integer number of seconds.");
    }

    this.secret = options.secret;
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
    this.accessTokenExpirySeconds =
      options.accessTokenExpirySeconds ?? DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS;
    this.clock = options.clock;
  }

  public sign(input: SignAuthTokenInput): SignAuthTokenResult {
    const issuedAt = this.clock.nowUnixSeconds();
    const expiresInSeconds = input.expiresInSeconds ?? this.accessTokenExpirySeconds;
    const expiresAtUnix = issuedAt + expiresInSeconds;

    const claims: AuthJwtClaims = {
      sub: input.userId,
      username: input.username,
      role: input.role,
      jti: input.jwtId,
      iat: issuedAt,
      exp: expiresAtUnix,
      iss: this.issuer,
    };

    const token = jwt.sign(claims, this.secret, {
      algorithm: "HS256",
      header: { alg: 'HS256', typ: "JWT" },
      mutatePayload: false,
    });

    return {
      token,
      claims,
      expiresAt: new Date(expiresAtUnix * 1000),
    };
  }

  public verify(token: string): AuthJwtClaims {
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new JwtVerificationError("TOKEN_INVALID", "JWT token is missing.");
    }

    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: this.issuer,
        clockTimestamp: this.clock.nowUnixSeconds(),
      });

      return this.validateClaims(decoded);
    } catch (error) {
      if (error instanceof JwtVerificationError) {
        throw error;
      }

      if (error instanceof jwt.TokenExpiredError) {
        throw new JwtVerificationError("TOKEN_EXPIRED", "JWT token is expired.");
      }

      if (
        error instanceof jwt.JsonWebTokenError &&
        error.message.toLowerCase().includes("issuer")
      ) {
        throw new JwtVerificationError(
          "TOKEN_WRONG_ISSUER",
          "JWT token issuer is invalid.",
        );
      }

      throw new JwtVerificationError("TOKEN_INVALID", "JWT token is invalid.");
    }
  }

  private validateClaims(decoded: string | JwtPayload): AuthJwtClaims {
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new JwtVerificationError("TOKEN_INVALID", "JWT payload must be an object.");
    }

    const claims = decoded as Record<string, unknown>;
    const role = claims.role;

    if (!isAuthRole(role)) {
      throw new JwtVerificationError("TOKEN_INVALID", "JWT role claim is invalid.");
    }

    const requiredStringClaims = ["sub", "username", "jti", "iss"] as const;
    for (const claimName of requiredStringClaims) {
      if (typeof claims[claimName] !== "string" || claims[claimName].length === 0) {
        throw new JwtVerificationError(
          "TOKEN_INVALID",
          `JWT ${claimName} claim is invalid.`,
        );
      }
    }

    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
      throw new JwtVerificationError("TOKEN_INVALID", "JWT time claims are invalid.");
    }

    return {
      sub: claims.sub as string,
      username: claims.username as string,
      role,
      jti: claims.jti as string,
      iat: claims.iat,
      exp: claims.exp,
      iss: claims.iss as string,
    };
  }
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === "admin" || value === "security_engineer" || value === "soc_analyst";
}
