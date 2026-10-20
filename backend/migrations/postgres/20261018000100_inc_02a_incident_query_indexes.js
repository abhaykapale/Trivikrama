/**
 * INC-02A: tenant-scoped indexes for incident list and detail API reads.
 *
 * The migration is non-transactional because PostgreSQL requires concurrent
 * index operations to run outside an explicit transaction.
 */

async function up(knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_created
      ON public.incidents (org_id, created_at DESC, id DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_updated
      ON public.incidents (org_id, updated_at DESC, id DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_risk
      ON public.incidents (org_id, risk_score DESC, id DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_severity
      ON public.incidents (org_id, severity DESC, id DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_alert_count
      ON public.incidents (org_id, alert_count DESC, id DESC);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_title_trgm
      ON public.incidents USING GIN (title gin_trgm_ops);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_description_trgm
      ON public.incidents USING GIN (description gin_trgm_ops);
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_primary_entity_trgm
      ON public.incidents USING GIN (primary_entity gin_trgm_ops);
  `);
}

async function down(knex) {
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_primary_entity_trgm;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_description_trgm;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_title_trgm;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_alert_count;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_severity;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_risk;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_updated;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_created;",
  );
}

const config = { transaction: false };

module.exports = { up, down, config };
