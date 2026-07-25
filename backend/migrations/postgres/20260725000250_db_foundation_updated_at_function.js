/**
 * Corrective foundation migration.
 *
 * Creates the shared updated_at trigger function used by relational tables.
 *
 * Why this exists:
 * - DB-001 defines update_updated_at_column().
 * - Earlier migrations created tables that expect this function.
 * - DB-05A failed because the function was missing.
 */

export async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.update_updated_at_column();
  `);
}

export const config = {
  transaction: true,
};
