/** AUDIT-01A: tenant-first indexes for immutable audit investigation reads. */

async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created_id
      ON audit.audit_logs (org_id, created_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_created
      ON audit.audit_logs (org_id, action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_actor_created
      ON audit.audit_logs (org_id, actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_target_created
      ON audit.audit_logs (org_id, target_type, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_org_ip_created
      ON audit.audit_logs (org_id, ip_address, created_at DESC);
  `);
}

async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS audit.idx_audit_logs_org_ip_created;
    DROP INDEX IF EXISTS audit.idx_audit_logs_org_target_created;
    DROP INDEX IF EXISTS audit.idx_audit_logs_org_actor_created;
    DROP INDEX IF EXISTS audit.idx_audit_logs_org_action_created;
    DROP INDEX IF EXISTS audit.idx_audit_logs_org_created_id;
  `);
}

module.exports = { up, down };
