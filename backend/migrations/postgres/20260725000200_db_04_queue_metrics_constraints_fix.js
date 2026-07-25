/**
 * Corrective migration for DB-04.
 *
 * Adds database-level non-negative constraints to
 * monitor.queue_metrics.
 *
 * This migration is required because DB-04 was already applied
 * in the same Knex batch as the initial relational tables.
 *
 * The checks are intentionally added here instead of DB-04 so
 * existing databases that have already recorded DB-04 remain
 * compatible with the corrective migration history.
 */

async function up(knex) {
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
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_queue_metrics_waiting_nonnegative'
          AND conrelid = 'monitor.queue_metrics'::regclass
      ) THEN
        ALTER TABLE monitor.queue_metrics
          ADD CONSTRAINT chk_queue_metrics_waiting_nonnegative
          CHECK (waiting >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_queue_metrics_active_nonnegative'
          AND conrelid = 'monitor.queue_metrics'::regclass
      ) THEN
        ALTER TABLE monitor.queue_metrics
          ADD CONSTRAINT chk_queue_metrics_active_nonnegative
          CHECK (active >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_queue_metrics_completed_nonnegative'
          AND conrelid = 'monitor.queue_metrics'::regclass
      ) THEN
        ALTER TABLE monitor.queue_metrics
          ADD CONSTRAINT chk_queue_metrics_completed_nonnegative
          CHECK (completed >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_queue_metrics_failed_nonnegative'
          AND conrelid = 'monitor.queue_metrics'::regclass
      ) THEN
        ALTER TABLE monitor.queue_metrics
          ADD CONSTRAINT chk_queue_metrics_failed_nonnegative
          CHECK (failed >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conname = 'chk_queue_metrics_dead_lettered_nonnegative'
          AND conrelid = 'monitor.queue_metrics'::regclass
      ) THEN
        ALTER TABLE monitor.queue_metrics
          ADD CONSTRAINT chk_queue_metrics_dead_lettered_nonnegative
          CHECK (dead_lettered >= 0);
      END IF;
    END
    $$;
  `);
}

async function down(knex) {
  await knex.raw(`
    ALTER TABLE monitor.queue_metrics
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_waiting_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_active_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_completed_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_failed_nonnegative,
      DROP CONSTRAINT IF EXISTS chk_queue_metrics_dead_lettered_nonnegative;
  `);
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
