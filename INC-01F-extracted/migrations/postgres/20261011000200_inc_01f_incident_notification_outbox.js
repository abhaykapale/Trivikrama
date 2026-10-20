/**
 * INC-01F: durable transactional handoff from incident persistence to Redis.
 */

async function up(knex) {
  await knex.raw(`
    CREATE TABLE public.incident_notification_outbox (
      id                UUID PRIMARY KEY,
      org_id            VARCHAR(100) NOT NULL,
      incident_id       UUID NOT NULL
        REFERENCES public.incidents(id)
        ON DELETE CASCADE,
      event_type        VARCHAR(40) NOT NULL,
      channel           VARCHAR(64) NOT NULL,
      deduplication_key VARCHAR(500) NOT NULL UNIQUE,
      payload           JSONB NOT NULL,
      status            VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempt_count     INTEGER NOT NULL DEFAULT 0,
      available_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at         TIMESTAMPTZ,
      locked_until      TIMESTAMPTZ,
      lock_owner        VARCHAR(200),
      published_at      TIMESTAMPTZ,
      last_error        VARCHAR(1000),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_incident_outbox_event_type
        CHECK (event_type IN (
          'INCIDENT_CREATED',
          'INCIDENT_UPDATED',
          'INCIDENT_STATUS_CHANGED'
        )),
      CONSTRAINT chk_incident_outbox_channel
        CHECK (channel IN ('incidents:new', 'incidents:updated', 'incidents:status')),
      CONSTRAINT chk_incident_outbox_event_channel
        CHECK (
          (event_type = 'INCIDENT_CREATED' AND channel = 'incidents:new') OR
          (event_type = 'INCIDENT_UPDATED' AND channel = 'incidents:updated') OR
          (event_type = 'INCIDENT_STATUS_CHANGED' AND channel = 'incidents:status')
        ),
      CONSTRAINT chk_incident_outbox_status
        CHECK (status IN ('pending', 'published', 'dead_letter')),
      CONSTRAINT chk_incident_outbox_attempt_count
        CHECK (attempt_count >= 0),
      CONSTRAINT chk_incident_outbox_payload_object
        CHECK (jsonb_typeof(payload) = 'object'),
      CONSTRAINT chk_incident_outbox_payload_envelope
        CHECK (
          (payload ->> 'id') IS NOT DISTINCT FROM id::text AND
          (payload ->> 'type') IS NOT DISTINCT FROM event_type AND
          (payload ->> 'orgId') IS NOT DISTINCT FROM org_id AND
          (payload #>> '{data,incidentId}') IS NOT DISTINCT FROM incident_id::text
        ),
      CONSTRAINT chk_incident_outbox_lock_pair
        CHECK ((lock_owner IS NULL) = (locked_until IS NULL)),
      CONSTRAINT chk_incident_outbox_published_state
        CHECK (
          (status = 'published' AND published_at IS NOT NULL) OR
          (status <> 'published' AND published_at IS NULL)
        )
    );

    CREATE INDEX idx_incident_outbox_dispatch
      ON public.incident_notification_outbox (available_at, created_at, id)
      WHERE status = 'pending';

    CREATE INDEX idx_incident_outbox_org_incident
      ON public.incident_notification_outbox (org_id, incident_id, created_at DESC);

    CREATE INDEX idx_incident_outbox_dead_letter
      ON public.incident_notification_outbox (updated_at DESC)
      WHERE status = 'dead_letter';
  `);
}

async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS public.incident_notification_outbox;`);
}

const config = { transaction: true };

module.exports = { up, down, config };
