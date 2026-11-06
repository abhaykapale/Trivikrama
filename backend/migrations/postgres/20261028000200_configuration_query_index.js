/** CONFIG-01A: bounded non-sensitive configuration listing support. */
async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_configuration_public_key
      ON public.configuration (key ASC)
      WHERE is_sensitive = FALSE;
  `);
}
async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS public.idx_configuration_public_key;");
}
module.exports = { up, down };
