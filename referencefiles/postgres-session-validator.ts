import type { Knex } from "knex";

interface ClockLike {
  now(): Date;
}

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly jwt_id: string;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly revoked_at: Date | string | null;
}

export type SessionInvalidReason = "not_found" | "revoked" | "expired";

export type SessionValidationResult =
  | {
      readonly valid: true;
      readonly session: {
        readonly id: string;
        readonly userId: string;
        readonly jwtId: string;
        readonly expiresAt: Date;
        readonly createdAt: Date;
      };
    }
  | {
      readonly valid: false;
      readonly reason: SessionInvalidReason;
    };

export class PostgresSessionValidator {
  public constructor(
    private readonly knex: Knex,
    private readonly clock: ClockLike,
  ) {}

  public async validateSession(jwtId: string): Promise<SessionValidationResult> {
    if (typeof jwtId !== "string" || jwtId.trim().length === 0) {
      return { valid: false, reason: "not_found" };
    }

    const row = await this.knex<SessionRow>("sessions")
      .select("id", "user_id", "jwt_id", "expires_at", "created_at", "revoked_at")
      .where("jwt_id", jwtId)
      .first();

    if (!row) {
      return { valid: false, reason: "not_found" };
    }

    if (row.revoked_at !== null) {
      return { valid: false, reason: "revoked" };
    }

    const now = this.clock.now();
    const expiresAt = new Date(row.expires_at);

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      session: {
        id: row.id,
        userId: row.user_id,
        jwtId: row.jwt_id,
        expiresAt,
        createdAt: new Date(row.created_at),
      },
    };
  }
}
