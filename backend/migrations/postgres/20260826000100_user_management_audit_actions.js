/** Adds the documented audit actions required by user-management mutations. */
const ACTIONS = ["user_password_reset"];

/** @param {import("knex").Knex} knex */
exports.up = async function up(knex) {
  for (const action of ACTIONS) {
    await knex.raw(`ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS '${action}';`);
  }
};

/** PostgreSQL enum values are intentionally forward-only. */
exports.down = async function down() {};
