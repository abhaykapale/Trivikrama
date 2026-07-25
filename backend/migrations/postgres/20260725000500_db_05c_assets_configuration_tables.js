/**
 * DB-05C: Asset registry and application configuration.
 *
 * Owns:
 * - public.assets
 * - public.configuration
 *
 * Required existing objects:
 * - public.users
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
      `DB-05C requires ${schemaName}.${tableName} to exist before running.`,
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
          ON TABLE public.assets
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.configuration
          TO trivikrama_app;
      END IF;
    END
    $$;
  `);
}

export async function up(knex) {
  await assertTableExists(knex, "public", "users");

  await knex.raw(`
    CREATE TABLE public.assets (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      name              VARCHAR(255) NOT NULL,
      asset_type        VARCHAR(100) NOT NULL,
      ip_address        INET,
      hostname          VARCHAR(255),

      criticality       DECIMAL(3,2) NOT NULL DEFAULT 0.50,

      owner             VARCHAR(255),
      department        VARCHAR(255),

      tags              JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

      is_active         BOOLEAN NOT NULL DEFAULT TRUE,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      org_id            VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT chk_assets_criticality
        CHECK (criticality >= 0.00 AND criticality <= 1.00),

      CONSTRAINT chk_assets_name_not_blank
        CHECK (length(trim(name)) > 0),

      CONSTRAINT chk_assets_asset_type_not_blank
        CHECK (length(trim(asset_type)) > 0),

      CONSTRAINT chk_assets_tags_array
        CHECK (jsonb_typeof(tags) = 'array'),

      CONSTRAINT chk_assets_metadata_object
        CHECK (jsonb_typeof(metadata) = 'object')
    );
  `);

  await knex.raw(`
    CREATE TABLE public.configuration (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

      key               VARCHAR(255) NOT NULL,
      value             JSONB NOT NULL,
      description       TEXT,
      is_sensitive      BOOLEAN NOT NULL DEFAULT FALSE,

      updated_by        UUID
        REFERENCES public.users(id)
        ON DELETE SET NULL,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT uq_configuration_key
        UNIQUE (key),

      CONSTRAINT chk_configuration_key_not_blank
        CHECK (length(trim(key)) > 0)
    );
  `);

  await knex.raw(`
    CREATE TRIGGER trg_assets_updated_at
      BEFORE UPDATE ON public.assets
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER trg_configuration_updated_at
      BEFORE UPDATE ON public.configuration
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `);

  /*
   * DB-001 indexes:
   * - asset lookup by IP for risk scoring
   * - asset lookup by hostname for risk scoring
   *
   * Extra:
   * - active asset list by type/name for asset registry UI.
   */
  await knex.raw(`
    CREATE INDEX idx_assets_ip
      ON public.assets (ip_address)
      WHERE is_active = TRUE;

    CREATE INDEX idx_assets_hostname
      ON public.assets (hostname)
      WHERE is_active = TRUE;

    CREATE INDEX idx_assets_type_name
      ON public.assets (asset_type, name)
      WHERE is_active = TRUE;
  `);

  await grantRuntimePrivilegesIfRoleExists(knex);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS public.configuration;
    DROP TABLE IF EXISTS public.assets;
  `);
}

export const config = {
  transaction: true,
};
