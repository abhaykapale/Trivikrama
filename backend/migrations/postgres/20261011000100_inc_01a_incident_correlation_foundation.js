/**
 * INC-01A: harden the existing incident table for typed correlation data and
 * add the tenant-scoped lookup index used by the incident correlator.
 */

async function up(knex) {
  await knex.raw(`
    ALTER TABLE public.incidents
      ADD CONSTRAINT chk_incidents_primary_entity_pair
        CHECK ((primary_entity IS NULL) = (entity_type IS NULL)),
      ADD CONSTRAINT chk_incidents_score_breakdown_object
        CHECK (jsonb_typeof(score_breakdown) = 'object'),
      ADD CONSTRAINT chk_incidents_entities_array
        CHECK (jsonb_typeof(entities) = 'array'),
      ADD CONSTRAINT chk_incidents_kill_chain_stages_array
        CHECK (jsonb_typeof(kill_chain_stages) = 'array');
  `);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_org_open_entity_time
      ON public.incidents (
        org_id,
        entity_type,
        primary_entity,
        last_event_at DESC
      )
      WHERE status IN ('open', 'investigating')
        AND last_event_at IS NOT NULL;
  `);
}

async function down(knex) {
  await knex.raw(`
    DROP INDEX CONCURRENTLY IF EXISTS public.idx_incidents_org_open_entity_time;
  `);

  await knex.raw(`
    ALTER TABLE public.incidents
      DROP CONSTRAINT IF EXISTS chk_incidents_kill_chain_stages_array,
      DROP CONSTRAINT IF EXISTS chk_incidents_entities_array,
      DROP CONSTRAINT IF EXISTS chk_incidents_score_breakdown_object,
      DROP CONSTRAINT IF EXISTS chk_incidents_primary_entity_pair;
  `);
}

const config = {
  transaction: false,
};

module.exports = { up, down, config };
