/** INC-03D: audit action for reasoned incident resolution. */

async function up(knex) {
  await knex.raw(`
    ALTER TYPE public.audit_action
      ADD VALUE IF NOT EXISTS 'incident_resolve';
  `);
}

/** PostgreSQL enum values are intentionally forward-only. */
async function down() {}

const config = { transaction: true };

module.exports = { up, down, config };
