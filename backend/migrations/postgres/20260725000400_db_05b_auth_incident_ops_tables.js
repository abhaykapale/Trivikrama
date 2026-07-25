/**
 * DB-05B: Auth, incident collaboration, and collector operations tables.
 *
 * Owns:
 * - public.sessions
 * - public.incident_notes
 * - monitor.collector_status
 *
 * Required existing objects:
 * - public.users
 * - public.incidents
 * - monitor schema
 * - enum collector_status_enum
 */

async function assertSchemaExists(knex, schemaName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace
        WHERE nspname = ?
      ) AS "exists";
    `,
    [schemaName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(`DB-05B requires schema ${schemaName} to exist.`);
  }
}

async function assertTableExists(knex, schemaName, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = ?
          AND c.relname = ?
          AND c.relkind IN ('r', 'p')
      ) AS "exists";
    `,
    [schemaName, tableName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-05B requires ${schemaName}.${tableName} to exist before running.`,
    );
  }
}

async function assertEnumExists(knex, schemaName, typeName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n
          ON n.oid = t.typnamespace
        WHERE n.nspname = ?
          AND t.typname = ?
          AND t.typtype = 'e'
      ) AS "exists";
    `,
    [schemaName, typeName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-05B requires enum ${schemaName}.${typeName} to exist before running.`,
    );
  }
}

async function grantRuntimePrivilegesIfRoleExists(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'trivikrama_app'
      ) THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.sessions
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.incident_notes
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE monitor.collector_status
          TO trivikrama_app;
      END IF;
    END
    $$;
  `);
}

async function up(knex) {
  await assertSchemaExists(knex, "monitor");
  await assertTableExists(knex, "public", "users");
  await assertTableExists(knex, "public", "incidents");
  await assertEnumExists(knex, "public", "collector_status_enum");

  await knex.raw(`
    CREATE TABLE public.sessions (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      user_id           UUID NOT NULL
        REFERENCES public.users(id)
        ON DELETE CASCADE,

      jwt_id            VARCHAR(255) NOT NULL,
      ip_address        INET,
      user_agent        TEXT,
      expires_at        TIMESTAMPTZ NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at        TIMESTAMPTZ,

      CONSTRAINT uq_sessions_jwt_id
        UNIQUE (jwt_id)
    );
  `);

  await knex.raw(`
    CREATE TABLE public.incident_notes (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      incident_id       UUID NOT NULL
        REFERENCES public.incidents(id)
        ON DELETE CASCADE,

      author_id         UUID NOT NULL
        REFERENCES public.users(id)
        ON DELETE CASCADE,

      content           TEXT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_incident_notes_content_not_blank
        CHECK (length(trim(content)) > 0)
    );
  `);

  await knex.raw(`
    CREATE TABLE monitor.collector_status (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      collector_id      VARCHAR(255) NOT NULL,
      status            collector_status_enum NOT NULL DEFAULT 'offline',

      last_heartbeat_at TIMESTAMPTZ,
      heartbeat_data    JSONB NOT NULL DEFAULT '{}'::jsonb,

      files_processed   BIGINT NOT NULL DEFAULT 0,
      events_collected  BIGINT NOT NULL DEFAULT 0,
      events_dropped    BIGINT NOT NULL DEFAULT 0,
      errors_count      BIGINT NOT NULL DEFAULT 0,

      cpu_percent       DECIMAL(5,2),
      memory_mb         DECIMAL(10,2),

      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      org_id            VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT uq_collector_status_collector_id
        UNIQUE (collector_id),

      CONSTRAINT chk_collector_metrics_non_negative
        CHECK (
          files_processed >= 0
          AND events_collected >= 0
          AND events_dropped >= 0
          AND errors_count >= 0
        ),

      CONSTRAINT chk_collector_cpu_percent_range
        CHECK (
          cpu_percent IS NULL
          OR (cpu_percent >= 0.00 AND cpu_percent <= 100.00)
        ),

      CONSTRAINT chk_collector_memory_mb_nonnegative
        CHECK (
          memory_mb IS NULL
          OR memory_mb >= 0.00
        ),

      CONSTRAINT chk_collector_heartbeat_data_object
        CHECK (jsonb_typeof(heartbeat_data) = 'object')
    );
  `);

  await knex.raw(`
    CREATE TRIGGER trg_incident_notes_updated_at
      BEFORE UPDATE ON public.incident_notes
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER trg_collector_status_updated_at
      BEFORE UPDATE ON monitor.collector_status
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `);

  /*
   * Indexes from DB-001:
   * - sessions: JWT lookup and cleanup
   * - collector_status: unhealthy collectors
   *
   * Extra useful index:
   * - incident_notes by incident for incident detail view
   */
  await knex.raw(`
    CREATE INDEX idx_sessions_jwt_id
      ON public.sessions (jwt_id)
      WHERE revoked_at IS NULL;

    CREATE INDEX idx_sessions_expires_at
      ON public.sessions (expires_at);

    CREATE INDEX idx_incident_notes_incident_created
      ON public.incident_notes (incident_id, created_at DESC);

    CREATE INDEX idx_collector_status_status
      ON monitor.collector_status (status)
      WHERE status != 'online';
  `);

  await grantRuntimePrivilegesIfRoleExists(knex);
}

async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS monitor.collector_status;
    DROP TABLE IF EXISTS public.incident_notes;
    DROP TABLE IF EXISTS public.sessions;
  `);
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
