/**
 * Corrective migration for DB-04.
 *
 * Adds database-level non-negative constraints to
 * monitor.queue_metrics.
 *
 * This migration is required because DB-04 was already applied
 * in the same Knex batch as the initial relational tables.
 */

export async function up(knex) {
  /*
   * Existing invalid rows must be corrected before PostgreSQL can
   * validate the new CHECK constraints.
   *
   * This deletes only impossible queue-metric records.
   * In production, we might archive them first for investigation.
   */
  await knex.raw(`
    DELETE FROM monitor.queue_metrics
    WHERE waiting < 0
       OR active < 0
       OR completed < 0
       OR failed < 0
       OR dead_lettered < 0;
  `);

  await knex.raw(`
    ALTER TABLE monitor.queue_metrics
      ADD CONSTRAINT chk_queue_metrics_waiting_nonnegative
        CHECK (waiting >= 0),

      ADD CONSTRAINT chk_queue_metrics_active_nonnegative
        CHECK (active >= 0),

      ADD CONSTRAINT chk_queue_metrics_completed_nonnegative
        CHECK (completed >= 0),

      ADD CONSTRAINT chk_queue_metrics_failed_nonnegative
        CHECK (failed >= 0),

      ADD CONSTRAINT chk_queue_metrics_dead_lettered_nonnegative
        CHECK (dead_lettered >= 0);
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE monitor.queue_metrics
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_waiting_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_active_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_completed_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_failed_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_dead_lettered_nonnegative;
  `);
}

export const config = {
  transaction: true,
};
