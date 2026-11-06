/** DASH-01A: tenant/time indexes for dashboard aggregation queries. */

async function up(knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_org_created_type
      ON public.alerts (org_id, created_at DESC, alert_type);
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_created_dashboard
      ON public.incidents (org_id, created_at DESC, status, severity, source);
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_entity_created
      ON public.incidents (org_id, primary_entity, entity_type, created_at DESC)
      WHERE primary_entity IS NOT NULL AND entity_type IS NOT NULL;
  `);
}

async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_entity_created;");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_created_dashboard;");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS public.idx_alerts_org_created_type;");
}

const config = { transaction: false };
module.exports = { up, down, config };
