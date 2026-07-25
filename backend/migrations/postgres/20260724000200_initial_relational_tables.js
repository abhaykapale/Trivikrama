/**
 * Core PostgreSQL relational tables.
 *
 * DB-04 exclusively owns these partitioned tables:
 * - audit.audit_logs
 * - public.incident_events
 * - monitor.queue_metrics
 *
 * Do not create them in this migration.
 */

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE public.users (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      username            VARCHAR(100) NOT NULL,
      email               VARCHAR(255) NOT NULL,
      password_hash       VARCHAR(255) NOT NULL,
      role                user_role NOT NULL DEFAULT 'soc_analyst',
      display_name        VARCHAR(255),

      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at       TIMESTAMPTZ,
      failed_login_count  INTEGER NOT NULL DEFAULT 0,
      locked_until        TIMESTAMPTZ,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      org_id              VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT uq_users_username_org
        UNIQUE (username, org_id),

      CONSTRAINT uq_users_email_org
        UNIQUE (email, org_id),

        CONSTRAINT chk_users_failed_login_count_nonnegative
        CHECK (failed_login_count >= 0)
    );
  `);

  await knex.raw(`
    CREATE TABLE public.incidents (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title               VARCHAR(500) NOT NULL,
      description         TEXT,

      status              incident_status NOT NULL DEFAULT 'open',
      severity            incident_severity NOT NULL DEFAULT 'medium',
      risk_score          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      source              incident_source NOT NULL DEFAULT 'rule',

      score_breakdown     JSONB NOT NULL DEFAULT '{}'::jsonb,

      primary_entity      VARCHAR(255),
      entity_type         VARCHAR(50),
      entities            JSONB NOT NULL DEFAULT '[]'::jsonb,

      kill_chain_stages   JSONB NOT NULL DEFAULT '[]'::jsonb,

      alert_count         INTEGER NOT NULL DEFAULT 0,
      event_count         INTEGER NOT NULL DEFAULT 0,

      assigned_to         UUID
        REFERENCES public.users(id)
        ON DELETE SET NULL,

      first_event_at      TIMESTAMPTZ,
      last_event_at       TIMESTAMPTZ,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at         TIMESTAMPTZ,
      closed_at           TIMESTAMPTZ,

      org_id              VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT chk_incidents_risk_score
        CHECK (risk_score >= 0 AND risk_score <= 100),

        CONSTRAINT chk_incidents_alert_count_nonnegative
            CHECK (alert_count >= 0),

        CONSTRAINT chk_incidents_event_count_nonnegative
            CHECK (event_count >= 0)
    );
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.incidents;
    DROP TABLE IF EXISTS public.users;
  `);
}

export const config = {
  transaction: true,
};
