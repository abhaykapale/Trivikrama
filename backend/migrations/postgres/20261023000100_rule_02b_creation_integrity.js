/**
 * RULE-02B gives the Sigma document identity a queryable, tenant-unique home.
 * Existing rows are backfilled from the top-level YAML `id` scalar when one
 * can be extracted safely; historical malformed rows remain nullable.
 *
 * @param {import('knex').Knex} knex
 */
async function up(knex) {
  await knex.schema.withSchema("public").alterTable("rules", (table) => {
    table.string("sigma_id", 128).nullable();
  });

  await knex.raw(`
    UPDATE public.rules
    SET sigma_id = (
      regexp_match(
        yaml_content,
        $rule_id$(?m)^id:[[:space:]]*["']?([a-z0-9][a-z0-9._-]{2,127})["']?[[:space:]]*$$rule_id$
      )
    )[1]
    WHERE sigma_id IS NULL;

    ALTER TABLE public.rules
      ADD CONSTRAINT chk_rules_sigma_id_format
      CHECK (
        sigma_id IS NULL
        OR sigma_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
      );

    CREATE UNIQUE INDEX uq_rules_org_sigma_id
      ON public.rules (org_id, sigma_id)
      WHERE sigma_id IS NOT NULL;

    CREATE UNIQUE INDEX uq_rules_org_name_ci
      ON public.rules (org_id, lower(name));
  `);
}

/**
 * @param {import('knex').Knex} knex
 */
async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS public.uq_rules_org_name_ci;
    DROP INDEX IF EXISTS public.uq_rules_org_sigma_id;
    ALTER TABLE public.rules
      DROP CONSTRAINT IF EXISTS chk_rules_sigma_id_format;
    ALTER TABLE public.rules
      DROP COLUMN IF EXISTS sigma_id;
  `);
}

module.exports = { up, down };
