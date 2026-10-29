/**
 * INC-03C: audit action and database-level note length enforcement.
 */

async function up(knex) {
  await knex.raw(`
    ALTER TYPE public.audit_action
      ADD VALUE IF NOT EXISTS 'incident_note_added';
  `);
  await knex.raw(`
    ALTER TABLE public.incident_notes
      ADD CONSTRAINT chk_incident_notes_content_max_length
      CHECK (char_length(content) <= 10000);
  `);
}

async function down(knex) {
  await knex.raw(`
    ALTER TABLE public.incident_notes
      DROP CONSTRAINT IF EXISTS chk_incident_notes_content_max_length;
  `);
}

const config = { transaction: true };

module.exports = { up, down, config };
