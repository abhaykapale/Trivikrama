/**
 * DB-05D: PostgreSQL schema integrity hardening.
 *
 * Owns corrective integrity controls that were missing after DB-05C:
 * - updated_at triggers for public.users and public.incidents
 * - incident lifecycle timestamp constraints
 * - database-level audit log immutability
 * - least-privilege grants for the runtime database role when it exists
 *
 * Required existing objects:
 * - public.users
 * - public.incidents
 * - audit.audit_logs
 * - public.update_updated_at_column()
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
    throw new Error(`DB-05D requires schema ${schemaName} to exist.`);
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
      `DB-05D requires ${schemaName}.${tableName} to exist before running.`,
    );
  }
}

async function assertFunctionExists(knex, schemaName, functionName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n
          ON n.oid = p.pronamespace
        WHERE n.nspname = ?
          AND p.proname = ?
      ) AS "exists";
    `,
    [schemaName, functionName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-05D requires function ${schemaName}.${functionName} to exist before running.`,
    );
  }
}

async function addUpdatedAtTriggers(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;

    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON public.users
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_incidents_updated_at ON public.incidents;

    CREATE TRIGGER trg_incidents_updated_at
      BEFORE UPDATE ON public.incidents
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  `);
}

async function addIncidentLifecycleConstraints(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.incidents'::regclass
          AND conname = 'chk_incidents_resolved_at_status'
      ) THEN
        ALTER TABLE public.incidents
          ADD CONSTRAINT chk_incidents_resolved_at_status
          CHECK (
            resolved_at IS NULL
            OR status IN ('resolved', 'closed')
          );
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.incidents'::regclass
          AND conname = 'chk_incidents_closed_at_status'
      ) THEN
        ALTER TABLE public.incidents
          ADD CONSTRAINT chk_incidents_closed_at_status
          CHECK (
            closed_at IS NULL
            OR status = 'closed'
          );
      END IF;
    END
    $$;
  `);
}

async function addAuditImmutability(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit.prevent_audit_log_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'audit.audit_logs is immutable and cannot be updated or deleted'
        USING ERRCODE = 'insufficient_privilege';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit.audit_logs;

    CREATE TRIGGER trg_audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit.audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION audit.prevent_audit_log_mutation();
  `);
}

async function grantRuntimePrivilegesIfRoleExists(knex) {
  await knex.raw(`
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'trivikrama_app'
      ) THEN
        EXECUTE format(
          'GRANT CONNECT ON DATABASE %I TO trivikrama_app',
          current_database()
        );

        GRANT USAGE ON SCHEMA public, audit, monitor TO trivikrama_app;

        REVOKE CREATE ON SCHEMA public FROM trivikrama_app;
        REVOKE CREATE ON SCHEMA audit FROM trivikrama_app;
        REVOKE CREATE ON SCHEMA monitor FROM trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE
            public.users,
            public.incidents,
            public.rules,
            public.alerts,
            public.sessions,
            public.incident_notes,
            public.assets,
            public.configuration,
            public.incident_events
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE
            monitor.collector_status,
            monitor.queue_metrics
          TO trivikrama_app;

        GRANT SELECT, INSERT
          ON TABLE audit.audit_logs
          TO trivikrama_app;

        REVOKE UPDATE, DELETE, TRUNCATE
          ON TABLE audit.audit_logs
          FROM trivikrama_app;
      END IF;
    END
    $$;
  `);
}

async function up(knex) {
  await assertSchemaExists(knex, "public");
  await assertSchemaExists(knex, "audit");
  await assertSchemaExists(knex, "monitor");

  await assertTableExists(knex, "public", "users");
  await assertTableExists(knex, "public", "incidents");
  await assertTableExists(knex, "public", "rules");
  await assertTableExists(knex, "public", "alerts");
  await assertTableExists(knex, "public", "sessions");
  await assertTableExists(knex, "public", "incident_notes");
  await assertTableExists(knex, "public", "assets");
  await assertTableExists(knex, "public", "configuration");
  await assertTableExists(knex, "public", "incident_events");
  await assertTableExists(knex, "audit", "audit_logs");
  await assertTableExists(knex, "monitor", "collector_status");
  await assertTableExists(knex, "monitor", "queue_metrics");

  await assertFunctionExists(knex, "public", "update_updated_at_column");

  await addUpdatedAtTriggers(knex);
  await addIncidentLifecycleConstraints(knex);
  await addAuditImmutability(knex);
  await grantRuntimePrivilegesIfRoleExists(knex);
}

async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit.audit_logs;
    DROP FUNCTION IF EXISTS audit.prevent_audit_log_mutation();
  `);

  await knex.raw(`
    ALTER TABLE public.incidents
      DROP CONSTRAINT IF EXISTS chk_incidents_resolved_at_status,
      DROP CONSTRAINT IF EXISTS chk_incidents_closed_at_status;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_incidents_updated_at ON public.incidents;
    DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
  `);

  /*
   * Runtime grants are intentionally not revoked here.
   * Earlier migrations already granted table-level access, and revoking grants during
   * rollback can break an otherwise valid older application version. Privilege
   * tightening should be handled by a dedicated forward migration if required.
   */
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
