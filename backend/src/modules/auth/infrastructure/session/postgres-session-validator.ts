import type { Knex } from "knex";

import type {
  IClock,
  ISessionValidator,
} from "../../domain/auth.contracts.js";
import type { SessionValidationResult } from "../../domain/auth.types.js";

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly jwt_id: string;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly revoked_at: Date | string | null;
}

export class PostgresSessionValidator implements ISessionValidator {
  public constructor(
    private readonly knex: Knex,
    private readonly clock: IClock,
  ) {}

  public async validate(jwtId: string): Promise<SessionValidationResult> {
    if (typeof jwtId !== "string" || jwtId.trim().length === 0) {
      return { valid: false, session: null, reason: "not_found" };
    }

    const row = await this.knex<SessionRow>("sessions")
      .select("id", "user_id", "jwt_id", "expires_at", "created_at", "revoked_at")
      .where("jwt_id", jwtId)
      .first();

    if (!row) {
      return { valid: false, session: null, reason: "not_found" };
    }

    const expiresAt = new Date(row.expires_at);

    const session = {
      jwtId: row.jwt_id,
      userId: row.user_id,
      expiresAt,
      revokedAt: row.revoked_at !== null ? new Date(row.revoked_at) : null,
    } as const;

    if (row.revoked_at !== null) {
      return { valid: false, session, reason: "revoked" };
    }

    const now = this.clock.now();

    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      return { valid: false, session, reason: "expired" };
    }

    return {
      valid: true,
      session,
      reason: null,
    };
  }

  /** @deprecated Use validate() instead. */
  public async validateSession(jwtId: string): Promise<SessionValidationResult> {
    return this.validate(jwtId);
  }
}
