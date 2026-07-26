/**
 * DB-05E: Incident query indexes.
 *
 * Owns the PostgreSQL incident indexes required by dashboard, assignment,
 * investigation, risk ranking, and correlation lookup paths.
 *
 * This migration is intentionally non-transactional because PostgreSQL requires
 * CREATE INDEX CONCURRENTLY / DROP INDEX CONCURRENTLY to run outside an explicit
 * transaction block.
 *
 * Required existing objects:
 * - public.incidents
 */

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
      `DB-05E requires ${schemaName}.${tableName} to exist before running.`,
    );
  }
}

async function up(knex) {
  await assertTableExists(knex, "public", "incidents");

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_status_severity
      ON public.incidents (status, severity, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_severity_created
      ON public.incidents (severity, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_primary_entity
      ON public.incidents (primary_entity, created_at DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_assigned_to
      ON public.incidents (assigned_to, status)
      WHERE assigned_to IS NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_open_entity_time
      ON public.incidents (primary_entity, last_event_at DESC)
      WHERE status IN ('open', 'investigating');
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_risk_score
      ON public.incidents (risk_score DESC)
      WHERE status IN ('open', 'investigating');
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_id
      ON public.incidents (org_id);
  `);
}

async function down(knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_id;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_risk_score;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_open_entity_time;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_assigned_to;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_primary_entity;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_severity_created;`);
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_status_severity;`);
}

const config = {
  transaction: false,
};

module.exports = { up, down, config };
