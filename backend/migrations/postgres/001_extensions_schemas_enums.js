/**
 * Created:
 * - Required PostgreSQL extensions
 * - Logical schemas used by the application
 * - Enum types used by future table migrations
 *
 * the migration intentionally created no tables.
 */

/**
 * @typedef {import("knex").Knex} Knex
 */

const ENUM_TYPES = [
  ["incident_status", ["open", "investigating", "resolved", "closed"]],
  ["incident_severity", ["critical", "high", "medium", "low", "informational"]],
  ["incident_source", ["rule", "ai", "both"]],
  ["alert_type", ["rule", "ai"]],
  ["rule_status", ["active", "disabled", "archived"]],
  ["rule_type", ["match", "count", "sequence"]],
  ["rule_severity", ["critical", "high", "medium", "low", "informational"]],
  ["user_role", ["admin", "security_engineer", "soc_analyst"]],
  ["collector_status_enum", ["online", "degraded", "offline"]],
  [
    "audit_action",
    [
      "login",
      "logout",
      "incident_create",
      "incident_update",
      "incident_status_change",
      "incident_assign",
      "rule_create",
      "rule_update",
      "rule_delete",
      "rule_enable",
      "rule_disable",
      "rule_import",
      "user_create",
      "user_update",
      "user_delete",
      "config_change",
      "collector_config_change",
    ],
  ],
];

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/u; // sinple regex ada postgres samand

const quoteIdentifier = (identifier) => {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
};

const quoteLiteral = (value) => {
  return `'${String(value).replaceAll("'", "''")}'`;
};

const createEnumType = async (knex, typeName, values) => {
  const quotedTypeName = quoteIdentifier(typeName);
  const enumValues = values.map(quoteLiteral).join(", ");

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        INNER JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = ${quoteLiteral(typeName)}
          AND n.nspname = 'public'
      ) THEN
        CREATE TYPE public.${quotedTypeName} AS ENUM (${enumValues});
      END IF;
    END
    $$;
  `);
};

const dropEnumType = async (knex, typeName) => {
  const quotedTypeName = quoteIdentifier(typeName);

  await knex.raw(`DROP TYPE IF EXISTS public.${quotedTypeName};`);
};

/**
 * Apply migration.
 *
 * @param {Knex} knex
 * @returns {Promise<void>}
 */
async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');

  await knex.raw("CREATE SCHEMA IF NOT EXISTS audit;");
  await knex.raw("CREATE SCHEMA IF NOT EXISTS monitor;");

  for (const [typeName, values] of ENUM_TYPES) {
    await createEnumType(knex, typeName, values);
  }
}

/**
 * Roll back migration.
 *
 * @param {Knex} knex
 * @returns {Promise<void>}
 */
async function down(knex) {
  for (const [typeName] of [...ENUM_TYPES].reverse()) {
    await dropEnumType(knex, typeName);
  }

  await knex.raw("DROP SCHEMA IF EXISTS monitor;");
  await knex.raw("DROP SCHEMA IF EXISTS audit;");

  await knex.raw('DROP EXTENSION IF EXISTS "pg_trgm";');
  await knex.raw('DROP EXTENSION IF EXISTS "pgcrypto";');
  await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp";');
}

module.exports = { up, down };
