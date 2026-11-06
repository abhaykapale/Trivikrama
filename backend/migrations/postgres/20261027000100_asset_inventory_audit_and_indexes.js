/** ASSET-01A: immutable asset-change audit actions and tenant list index. */

const ASSET_AUDIT_ACTIONS = ["asset_create", "asset_update", "asset_delete"];

async function up(knex) {
  for (const action of ASSET_AUDIT_ACTIONS) {
    await knex.raw(`ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS '${action}';`);
  }
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_assets_org_active_criticality_name
      ON public.assets (org_id, is_active, criticality DESC, name ASC, id ASC);
  `);
}

/** PostgreSQL enum values are intentionally forward-only. */
async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS public.idx_assets_org_active_criticality_name;");
}

const config = { transaction: true };

module.exports = { up, down, config };
