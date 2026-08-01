import assert from "node:assert/strict";
import knexFactory from "knex";
import { PostgresSessionValidator } from "../../../src/modules/auth/infrastructure/session/postgres-session-validator.js";
import { UuidIdGenerator } from "../../../src/modules/auth/infrastructure/id/uuid-id-generator.js";
import env from "../../../src/config/env.js";
class FixedClock {
  public constructor(private readonly current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }
}

void main();

async function main(): Promise<void> {
  if (process.env.ALLOW_BE01B_INTEGRATION_TESTS !== "true") {
    console.log(
      JSON.stringify(
        {
          success: true,
          skipped: true,
          reason:
            "Set ALLOW_BE01B_INTEGRATION_TESTS=true to run PostgreSQL-backed session validation tests.",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!env.database.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for BE-01B integration tests.");
  }

  const knex = knexFactory({
    client: "pg",
    connection: env.database.DATABASE_URL,
    pool: { min: 0, max: 2 },
  });

  const idGenerator = new UuidIdGenerator();
  const clock = new FixedClock(new Date("2026-08-01T00:00:00.000Z"));
  const validator = new PostgresSessionValidator(knex, clock);
  const orgId = `be01b_test_${Date.now()}`;
  const userId = idGenerator.generateUuid();

  const activeJti = idGenerator.generateJwtId();
  const revokedJti = idGenerator.generateJwtId();
  const expiredJti = idGenerator.generateJwtId();

  try {
    await knex("users").insert({
      id: userId,
      username: `be01b_${Date.now()}`,
      email: `be01b_${Date.now()}@example.test`,
      password_hash:
        "$2b$12$ZjAo0XP3/ttgPRUboY7bNejpFy0bI5lOuegt.4vS4HhLqOFeAFBrS",
      role: "soc_analyst",
      display_name: "BE01B Test User",
      is_active: true,
      org_id: orgId,
    });

    await knex("sessions").insert([
      {
        id: idGenerator.generateUuid(),
        user_id: userId,
        jwt_id: activeJti,
        expires_at: new Date("2026-08-01T01:00:00.000Z"),
        created_at: new Date("2026-08-01T00:00:00.000Z"),
        revoked_at: null,
      },
      {
        id: idGenerator.generateUuid(),
        user_id: userId,
        jwt_id: revokedJti,
        expires_at: new Date("2026-08-01T01:00:00.000Z"),
        created_at: new Date("2026-08-01T00:00:00.000Z"),
        revoked_at: new Date("2026-08-01T00:10:00.000Z"),
      },
      {
        id: idGenerator.generateUuid(),
        user_id: userId,
        jwt_id: expiredJti,
        expires_at: new Date("2026-07-31T23:59:00.000Z"),
        created_at: new Date("2026-07-31T23:00:00.000Z"),
        revoked_at: null,
      },
    ]);

    assert.equal((await validator.validateSession(activeJti)).valid, true);

    assert.deepEqual(await validator.validateSession(revokedJti), {
      valid: false,
      reason: "revoked",
    });

    assert.deepEqual(await validator.validateSession(expiredJti), {
      valid: false,
      reason: "expired",
    });

    console.log(
      JSON.stringify(
        {
          success: true,
          totals: { tests: 3, passed: 3, failed: 0 },
        },
        null,
        2,
      ),
    );
  } finally {
    await knex("sessions")
      .whereIn("jwt_id", [activeJti, revokedJti, expiredJti])
      .delete();

    await knex("users").where("org_id", orgId).delete();
    await knex.destroy();
  }
}
