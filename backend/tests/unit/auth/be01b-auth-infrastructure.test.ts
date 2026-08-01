import assert from "node:assert/strict";
import { BcryptPasswordService } from "../../../src/modules/auth/infrastructure/password/bcrypt-password.service.js";
import {
  JwtService,
  JwtVerificationError,
} from "../../../src/modules/auth/infrastructure/token/jwt.service.js";
import { UuidIdGenerator } from "../../../src/modules/auth/infrastructure/id/uuid-id-generator.js";
import { PostgresSessionValidator } from "../../../src/modules/auth/infrastructure/session/postgres-session-validator.js";
import { redactAuthSecrets } from "../../../src/modules/auth/infrastructure/redaction/auth-redaction.js";

type TestCase = {
  readonly name: string;
  readonly run: () => Promise<void> | void;
};

class FixedClock {
  public constructor(private current: Date) {}

  public now(): Date {
    return new Date(this.current);
  }

  public nowUnixSeconds(): number {
    return Math.floor(this.current.getTime() / 1000);
  }

  public set(date: Date): void {
    this.current = date;
  }
}

const JWT_SECRET = "x".repeat(64);
const fixedClock = new FixedClock(new Date("2026-08-01T00:00:00.000Z"));

const tests: TestCase[] = [
  {
    name: "bcrypt hashes with 12 rounds and verifies correct password",
    run: async () => {
      const service = new BcryptPasswordService();
      const hash = await service.hashPassword("CorrectHorseBatteryStaple!123");

      assert.equal(service.rounds, 12);
      assert.match(hash, /^\$2[aby]\$12\$/);
      assert.equal(await service.verifyPassword("CorrectHorseBatteryStaple!123", hash), true);
    },
  },
  {
    name: "bcrypt rejects incorrect password and malformed hash safely",
    run: async () => {
      const service = new BcryptPasswordService();
      const hash = await service.hashPassword("CorrectHorseBatteryStaple!123");

      assert.equal(await service.verifyPassword("wrong-password", hash), false);
      assert.equal(await service.verifyPassword("anything", "not-a-bcrypt-hash"), false);
    },
  },
  {
    name: "jwt signs HS256 token and preserves required claims",
    run: () => {
      fixedClock.set(new Date("2026-08-01T00:00:00.000Z"));
      const service = new JwtService({ secret: JWT_SECRET, clock: fixedClock });
      const result = service.sign({
        userId: "6f22569d-657b-4737-bc38-2164556a1b4c",
        username: "analyst1",
        role: "soc_analyst",
        jwtId: "session-jti-1",
      });
      const claims = service.verify(result.token);

      assert.equal(claims.sub, "6f22569d-657b-4737-bc38-2164556a1b4c");
      assert.equal(claims.username, "analyst1");
      assert.equal(claims.role, "soc_analyst");
      assert.equal(claims.jti, "session-jti-1");
      assert.equal(claims.iss, "ai-siem");
      assert.equal(claims.iat, 1785542400);
      assert.equal(claims.exp, 1785546000);
    },
  },
  {
    name: "jwt rejects invalid token",
    run: () => {
      const service = new JwtService({ secret: JWT_SECRET, clock: fixedClock });

      assert.throws(
        () => service.verify("not-a-jwt"),
        (error) => error instanceof JwtVerificationError && error.code === "TOKEN_INVALID",
      );
    },
  },
  {
    name: "jwt rejects expired token",
    run: () => {
      fixedClock.set(new Date("2026-08-01T00:00:00.000Z"));
      const service = new JwtService({ secret: JWT_SECRET, clock: fixedClock });
      const { token } = service.sign({
        userId: "user-1",
        username: "analyst1",
        role: "soc_analyst",
        jwtId: "expired-jti",
        expiresInSeconds: 1,
      });

      fixedClock.set(new Date("2026-08-01T00:00:02.000Z"));
      assert.throws(
        () => service.verify(token),
        (error) => error instanceof JwtVerificationError && error.code === "TOKEN_EXPIRED",
      );
    },
  },
  {
    name: "jwt rejects wrong issuer",
    run: () => {
      fixedClock.set(new Date("2026-08-01T00:00:00.000Z"));
      const issuingService = new JwtService({
        secret: JWT_SECRET,
        issuer: "wrong-issuer",
        clock: fixedClock,
      });
      const verifyingService = new JwtService({
        secret: JWT_SECRET,
        issuer: "ai-siem",
        clock: fixedClock,
      });
      const { token } = issuingService.sign({
        userId: "user-1",
        username: "analyst1",
        role: "soc_analyst",
        jwtId: "wrong-issuer-jti",
      });

      assert.throws(
        () => verifyingService.verify(token),
        (error) => error instanceof JwtVerificationError && error.code === "TOKEN_WRONG_ISSUER",
      );
    },
  },
  {
    name: "session validator accepts active session and rejects revoked or expired sessions",
    run: async () => {
      const rows = new Map<string, unknown>([
        [
          "active-jti",
          {
            id: "session-1",
            user_id: "user-1",
            jwt_id: "active-jti",
            expires_at: new Date("2026-08-01T01:00:00.000Z"),
            created_at: new Date("2026-08-01T00:00:00.000Z"),
            revoked_at: null,
          },
        ],
        [
          "revoked-jti",
          {
            id: "session-2",
            user_id: "user-1",
            jwt_id: "revoked-jti",
            expires_at: new Date("2026-08-01T01:00:00.000Z"),
            created_at: new Date("2026-08-01T00:00:00.000Z"),
            revoked_at: new Date("2026-08-01T00:10:00.000Z"),
          },
        ],
        [
          "expired-jti",
          {
            id: "session-3",
            user_id: "user-1",
            jwt_id: "expired-jti",
            expires_at: new Date("2026-07-31T23:59:00.000Z"),
            created_at: new Date("2026-07-31T23:00:00.000Z"),
            revoked_at: null,
          },
        ],
      ]);

      const fakeKnex = createFakeKnex(rows);
      const clock = new FixedClock(new Date("2026-08-01T00:00:00.000Z"));
      const validator = new PostgresSessionValidator(fakeKnex, clock);

      assert.deepEqual(await validator.validateSession("missing-jti"), {
        valid: false,
        reason: "not_found",
      });
      assert.equal((await validator.validateSession("active-jti")).valid, true);
      assert.deepEqual(await validator.validateSession("revoked-jti"), {
        valid: false,
        reason: "revoked",
      });
      assert.deepEqual(await validator.validateSession("expired-jti"), {
        valid: false,
        reason: "expired",
      });
    },
  },
  {
    name: "uuid generator produces unique UUID values",
    run: () => {
      const generator = new UuidIdGenerator();
      const idA = generator.generateUuid();
      const idB = generator.generateJwtId();

      assert.match(idA, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.match(idB, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.notEqual(idA, idB);
    },
  },
  {
    name: "auth redaction removes secrets and JWT tokens without mutating safe fields",
    run: () => {
      const redacted = redactAuthSecrets({
        username: "analyst1",
        password: "do-not-log",
        nested: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          message: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        },
      });

      assert.equal(redacted.username, "analyst1");
      assert.equal(redacted.password, "<redacted>");
      assert.equal(redacted.nested.Authorization, "<redacted>");
      assert.equal(redacted.nested.message, "token <redacted-jwt>");
    },
  },
];

void main();
async function main(): Promise<void> {
  await runTests(tests);
}


async function runTests(testCases: readonly TestCase[]): Promise<void> {
  const results = [];

  for (const test of testCases) {
    const startedAt = Date.now();

    try {
      await test.run();
      results.push({ name: test.name, status: "pass", durationMs: Date.now() - startedAt });
    } catch (error) {
      results.push({
        name: test.name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => result.status === "fail").length;
  const output = {
    success: failed === 0,
    totals: {
      tests: results.length,
      passed: results.length - failed,
      failed,
    },
    results,
  };

  console.log(JSON.stringify(output, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function createFakeKnex(rows: Map<string, unknown>): any {
  return () => {
    let jwtId = "";

    return {
      select() {
        return this;
      },
      where(column: string, value: string) {
        assert.equal(column, "jwt_id");
        jwtId = value;
        return this;
      },
      async first() {
        return rows.get(jwtId);
      },
    };
  };
}
