/**
 * DB-05A: Detection tables.
 *
 * Owns:
 * - public.rules
 * - public.alerts

 * - Rule Engine loads Sigma-compatible rules from PostgreSQL.
 * - Rule Engine and AI Client generate alerts.
 * - Incident Correlator consumes alerts and links them to incidents.

 * Required existing objects:
 * - public.users
 * - public.incidents
 * - enum rule_status
 * - enum rule_type
 * - enum rule_severity
 * - enum alert_type
 */

async function assertTableExists(knex, schemaName, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = ?
          AND c.relname = ?
          AND c.relkind IN ('r', 'p')
      ) AS "exists";
    `,
    [schemaName, tableName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-05A requires ${schemaName}.${tableName} to exist before running.`,
    );
  }
}

async function assertEnumExists(knex, schemaName, typeName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n
          ON n.oid = t.typnamespace
        WHERE n.nspname = ?
          AND t.typname = ?
          AND t.typtype = 'e'
      ) AS "exists";
    `,
    [schemaName, typeName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-05A requires enum ${schemaName}.${typeName} to exist before running.`,
    );
  }
}

async function grantRuntimePrivilegesIfRoleExists(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'trivikrama_app'
      ) THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.rules
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.alerts
          TO trivikrama_app;
      END IF;
    END
    $$;
  `);
}

async function up(knex) {
  await assertTableExists(knex, "public", "users");
  await assertTableExists(knex, "public", "incidents");

  for (const enumName of [
    "rule_status",
    "rule_type",
    "rule_severity",
    "alert_type",
  ]) {
    await assertEnumExists(knex, "public", enumName);
  }

  /*
   * rules must be created before alerts because alerts.rule_id
   * references rules.id.
   */
  await knex.raw(`
    CREATE TABLE public.rules (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name              VARCHAR(255) NOT NULL,
      description       TEXT,

      status            rule_status NOT NULL DEFAULT 'active',
      type              rule_type NOT NULL DEFAULT 'match',
      severity          rule_severity NOT NULL DEFAULT 'medium',
      weight            DECIMAL(3,2) NOT NULL DEFAULT 0.50,

      yaml_content      TEXT NOT NULL,
      compiled_hash     VARCHAR(64),

      class_uid         INTEGER,
      category_uid      INTEGER,

      tags              JSONB NOT NULL DEFAULT '[]'::jsonb,
      false_positives   JSONB NOT NULL DEFAULT '[]'::jsonb,
      rule_references   JSONB NOT NULL DEFAULT '[]'::jsonb,

      version           INTEGER NOT NULL DEFAULT 1,
      is_builtin        BOOLEAN NOT NULL DEFAULT FALSE,

      created_by        UUID
        REFERENCES public.users(id)
        ON DELETE SET NULL,

      updated_by        UUID
        REFERENCES public.users(id)
        ON DELETE SET NULL,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      org_id            VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT chk_rules_weight
        CHECK (weight >= 0.00 AND weight <= 1.00),

      CONSTRAINT chk_rules_version
        CHECK (version > 0),

      CONSTRAINT chk_rules_yaml_content_not_blank
        CHECK (length(trim(yaml_content)) > 0),

      CONSTRAINT chk_rules_name_not_blank
        CHECK (length(trim(name)) > 0)
    );
  `);

  /*
   * alerts.incident_id is nullable by DB-001.
   *
   * Why nullable?
   * Alerts are produced first, then the Incident Correlator may attach
   * them to an existing or newly-created incident.
   */
  await knex.raw(`
    CREATE TABLE public.alerts (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      incident_id       UUID
        REFERENCES public.incidents(id)
        ON DELETE CASCADE,

      alert_type        alert_type NOT NULL,

      rule_id           UUID
        REFERENCES public.rules(id)
        ON DELETE SET NULL,

      rule_name         VARCHAR(255),
      matched_condition VARCHAR(500),

      anomaly_score     DECIMAL(5,4),
      confidence        DECIMAL(5,4),
      threat_category   VARCHAR(100),
      model_version     VARCHAR(50),
      shap_values       JSONB,

      severity          rule_severity NOT NULL DEFAULT 'medium',
      weight            DECIMAL(3,2) NOT NULL DEFAULT 0.50,
      tags              JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

      matched_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      org_id            VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT chk_alerts_anomaly_score
        CHECK (
          anomaly_score IS NULL
          OR (anomaly_score >= 0.0000 AND anomaly_score <= 1.0000)
        ),

      CONSTRAINT chk_alerts_confidence
        CHECK (
          confidence IS NULL
          OR (confidence >= 0.0000 AND confidence <= 1.0000)
        ),

      CONSTRAINT chk_alerts_weight
        CHECK (weight >= 0.00 AND weight <= 1.00),

      CONSTRAINT chk_alerts_matched_event_ids_array
        CHECK (jsonb_typeof(matched_event_ids) = 'array'),

      CONSTRAINT chk_alerts_tags_array
        CHECK (jsonb_typeof(tags) = 'array'),

      CONSTRAINT chk_alerts_metadata_object
        CHECK (jsonb_typeof(metadata) = 'object')
    );
  `);

  /*
   * Trigger function was created in DB-001 foundation migration.
   */
  await knex.raw(`
    CREATE TRIGGER trg_rules_updated_at
      BEFORE UPDATE ON public.rules
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `);

  /*
   * Indexes from DB-001.
   *
   * Rules:
   * - list active rules
   * - load active rules by OCSF class/category
   * - trigram search on name
   *
   * Alerts:
   * - load alerts for incident detail page
   * - filter rule vs AI alerts
   * - track alerts generated by rule
   * - find high anomaly AI alerts
   */
  await knex.raw(`
    CREATE INDEX idx_rules_status
      ON public.rules (status, severity, name);

    CREATE INDEX idx_rules_active_class
      ON public.rules (class_uid, category_uid)
      WHERE status = 'active';

    CREATE INDEX idx_rules_name_trgm
      ON public.rules
      USING gin (name gin_trgm_ops);

    CREATE INDEX idx_alerts_incident_id
      ON public.alerts (incident_id, created_at DESC);

    CREATE INDEX idx_alerts_type_created
      ON public.alerts (alert_type, created_at DESC);

    CREATE INDEX idx_alerts_rule_id
      ON public.alerts (rule_id)
      WHERE rule_id IS NOT NULL;

    CREATE INDEX idx_alerts_anomaly_score
      ON public.alerts (anomaly_score DESC)
      WHERE alert_type = 'ai'
        AND anomaly_score IS NOT NULL;
  `);

  await grantRuntimePrivilegesIfRoleExists(knex);
}

async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.alerts;
    DROP TABLE IF EXISTS public.rules;
  `);
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
