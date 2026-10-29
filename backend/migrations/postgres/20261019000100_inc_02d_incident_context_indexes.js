/**
 * INC-02D: tenant-aware lookup indexes for historical incident context.
 */

async function up(knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_entities_gin
      ON public.incidents USING GIN (entities jsonb_path_ops);
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_org_active_ip
      ON public.assets (org_id, ip_address)
      WHERE is_active = TRUE;
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_org_active_hostname
      ON public.assets (org_id, lower(hostname))
      WHERE is_active = TRUE;
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_org_active_name
      ON public.assets (org_id, lower(name))
      WHERE is_active = TRUE;
  `);
}

async function down(knex) {
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_assets_org_active_name;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_assets_org_active_hostname;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_assets_org_active_ip;",
  );
  await knex.raw(
    "DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_entities_gin;",
  );
}

const config = { transaction: false };

module.exports = { up, down, config };
