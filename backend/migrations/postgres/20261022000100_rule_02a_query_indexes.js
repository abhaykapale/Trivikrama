/**
 * RULE-02A tenant-first indexes for rule listing/detail and alert statistics.
 *
 * @param {import('knex').Knex} knex
 */
async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_rules_org_name_id
      ON public.rules (org_id, name ASC, id ASC);

    CREATE INDEX IF NOT EXISTS idx_rules_org_updated_id
      ON public.rules (org_id, updated_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_rules_org_filters
      ON public.rules (org_id, status, type, severity, is_builtin);

    CREATE INDEX IF NOT EXISTS idx_rules_tags_gin
      ON public.rules USING gin (tags);

    CREATE INDEX IF NOT EXISTS idx_alerts_org_rule_created
      ON public.alerts (org_id, rule_id, created_at DESC)
      WHERE rule_id IS NOT NULL;
  `);
}

/**
 * @param {import('knex').Knex} knex
 */
async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS public.idx_alerts_org_rule_created;
    DROP INDEX IF EXISTS public.idx_rules_tags_gin;
    DROP INDEX IF EXISTS public.idx_rules_org_filters;
    DROP INDEX IF EXISTS public.idx_rules_org_updated_id;
    DROP INDEX IF EXISTS public.idx_rules_org_name_id;
  `);
}

module.exports = { up, down };
