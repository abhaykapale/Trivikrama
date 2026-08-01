const assert = require("node:assert/strict");
const path = require("node:path");

const migrationPath = path.resolve(
  __dirname,
  "../../../migrations/postgres/20260801000100_be_01a_auth_repository_compatibility.js",
);
const migration = require(migrationPath);

const INDEXES = {
  "public.users": [
    {
      indexname: "uq_users_username_org",
      indexdef:
        "CREATE UNIQUE INDEX uq_users_username_org ON public.users USING btree (username, org_id)",
    },
  ],
  "public.sessions": [
    {
      indexname: "uq_sessions_jwt_id",
      indexdef:
        "CREATE UNIQUE INDEX uq_sessions_jwt_id ON public.sessions USING btree (jwt_id)",
    },
    {
      indexname: "idx_sessions_jwt_id",
      indexdef:
        "CREATE INDEX idx_sessions_jwt_id ON public.sessions USING btree (jwt_id) WHERE (revoked_at IS NULL)",
    },
    {
      indexname: "idx_sessions_expires_at",
      indexdef:
        "CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at)",
    },
  ],
  "audit.audit_logs": [
    {
      indexname: "idx_audit_logs_created",
      indexdef:
        "CREATE INDEX idx_audit_logs_created ON ONLY audit.audit_logs USING btree (created_at DESC)",
    },
    {
      indexname: "idx_audit_logs_action_created",
      indexdef:
        "CREATE INDEX idx_audit_logs_action_created ON audit.audit_logs USING btree (action, created_at DESC)",
    },
    {
      indexname: "idx_audit_logs_actor_created",
      indexdef:
        "CREATE INDEX idx_audit_logs_actor_created ON audit.audit_logs USING btree (actor_id, created_at DESC)",
    },
    {
      indexname: "idx_audit_logs_target_created",
      indexdef:
        "CREATE INDEX idx_audit_logs_target_created ON audit.audit_logs USING btree (target_type, target_id, created_at DESC)",
    },
  ],
};

async function main() {
  const statements = [];
  const knex = {
    async raw(sql, bindings = []) {
      statements.push({ sql, bindings });

      if (sql.includes("FROM pg_catalog.pg_indexes")) {
        const [schemaName, tableName] = bindings;
        return {
          rows: INDEXES[`${schemaName}.${tableName}`] ?? [],
        };
      }

      return { rows: [] };
    },
  };

  await migration.up(knex);

  const renderedSql = statements.map(({ sql }) => sql).join("\n");
  assert.match(
    renderedSql,
    /ALTER TYPE public\.audit_action ADD VALUE IF NOT EXISTS 'login_failed'/u,
  );
  assert.match(
    renderedSql,
    /ALTER TYPE public\.audit_action ADD VALUE IF NOT EXISTS 'session_revoked'/u,
  );
  assert.doesNotMatch(renderedSql, /CREATE\s+TABLE/iu);
  assert.doesNotMatch(renderedSql, /DROP\s+TABLE/iu);
  assert.deepEqual(migration.config, { transaction: true });

  await assert.rejects(
    () => migration.down(knex),
    /forward-only.*enum values cannot be safely removed/iu,
  );

  const missingIndexKnex = {
    async raw(sql) {
      if (sql.includes("FROM pg_catalog.pg_indexes")) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  await assert.rejects(
    () => migration.up(missingIndexKnex),
    /database foundation migrations/iu,
  );

  console.log(
    JSON.stringify(
      {
        success: true,
        suite: "BE-01A auth compatibility migration",
        tests: 6,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        suite: "BE-01A auth compatibility migration",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
