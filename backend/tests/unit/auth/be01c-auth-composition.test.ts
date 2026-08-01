import assert from "node:assert/strict";

import knexFactory from "knex";

import type {
  AuditListFilters,
  AuditLogRecord,
  CreateAuditLogInput,
  IAuditRepository,
} from "../../../src/database/repositories/audit/audit.repository.js";
import type { PageResult } from "../../../src/database/repositories/common/repository.types.js";

const VALID_SECRET =
  "v7Yp2Qm9Lx4Nc8Rt1Ks6Wd3Hj5Bf0Za7Pe2Uy9Mi4Go6Cq8Xs1Dv3Ln5Ak7Jr9Tw";

Object.assign(process.env, {
  NODE_ENV: "test",
  JWT_SECRET: VALID_SECRET,
  DATABASE_URL: "postgresql://app:test-password@localhost:5432/trivikrama_test",
  MONGODB_URI: "mongodb://localhost:27017/trivikrama_test",
  REDIS_URL: "redis://localhost:6379",
  COLLECTOR_HMAC_SECRET:
    "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw",
});

void main();

async function main(): Promise<void> {
  const [{ loadEnvironmentConfig }, { createPostgresRepositories }, composition] =
    await Promise.all([
      import("../../../src/config/env.js"),
      import("../../../src/database/repositories/postgres-repository.factory.js"),
      import("../../../src/modules/auth/composition/auth-application-dependencies.js"),
    ]);

  const knex = knexFactory({ client: "pg" });
  const auditRepository = new RecordingAuditRepository();

  try {
    const dependencies = composition.createAuthApplicationDependencies({
      knex,
      repositories: {
        ...createPostgresRepositories(knex),
        audit: auditRepository,
      },
      appConfig: loadEnvironmentConfig(process.env),
    });

    assert.ok(dependencies.authService);
    assert.ok(dependencies.loginUseCase);
    assert.ok(dependencies.logoutUseCase);
    assert.ok(dependencies.refreshTokenUseCase);
    assert.ok(dependencies.getCurrentUserUseCase);

    await dependencies.authAuditService.recordLoginSuccess({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "analyst",
        role: "soc_analyst",
      },
      ipAddress: "127.0.0.1",
      userAgent: "be01c-composition-test",
      orgId: "default",
    });

    assert.equal(auditRepository.records.length, 1);
    assert.equal(auditRepository.records[0]?.action, "login");
    assert.equal(auditRepository.records[0]?.details.event, "login_success");

    console.log(
      JSON.stringify(
        {
          success: true,
          suite: "BE-01C auth composition",
          tests: 2,
        },
        null,
        2,
      ),
    );
  } finally {
    await knex.destroy();
  }
}

class RecordingAuditRepository implements IAuditRepository {
  public readonly records: AuditLogRecord[] = [];

  public withTransaction(): IAuditRepository {
    return this;
  }

  public async create(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      id: input.id ?? "00000000-0000-4000-8000-000000000002",
      action: input.action,
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername ?? null,
      actorRole: input.actorRole ?? null,
      ipAddress: input.ipAddress ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetName: input.targetName ?? null,
      details: input.details ?? {},
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      orgId: input.orgId ?? "default",
    };

    this.records.push(record);
    return record;
  }

  public async list(
    _filters: AuditListFilters = {},
  ): Promise<PageResult<AuditLogRecord>> {
    return {
      items: this.records,
      limit: this.records.length,
      offset: 0,
      hasMore: false,
    };
  }

  public async findById(
    id: string,
    _createdAt?: Date,
  ): Promise<AuditLogRecord | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }
}
