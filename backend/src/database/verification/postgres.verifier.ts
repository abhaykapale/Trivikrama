import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { knex, type Knex } from "knex";

import type {
  DatabaseComponentVerificationResult,
  DatabaseVerificationCheck,
  PostgresVerificationConfig,
} from "./verification.types.js";

const REQUIRED_EXTENSIONS = ["uuid-ossp", "pgcrypto", "pg_trgm"] as const;
const REQUIRED_SCHEMAS = ["public", "audit", "monitor"] as const;

const REQUIRED_TABLES = [
  { schema: "public", table: "users" },
  { schema: "public", table: "sessions" },
  { schema: "public", table: "rules" },
  { schema: "public", table: "incidents" },
  { schema: "public", table: "alerts" },
  { schema: "public", table: "incident_events" },
  { schema: "public", table: "incident_notes" },
  { schema: "public", table: "assets" },
  { schema: "public", table: "configuration" },
  { schema: "audit", table: "audit_logs" },
  { schema: "monitor", table: "collector_status" },
  { schema: "monitor", table: "queue_metrics" },
] as const;

const REQUIRED_TRIGGERS = [
  { schema: "public", table: "users", trigger: "trg_users_updated_at" },
  { schema: "public", table: "rules", trigger: "trg_rules_updated_at" },
  { schema: "public", table: "incidents", trigger: "trg_incidents_updated_at" },
  {
    schema: "public",
    table: "incident_notes",
    trigger: "trg_incident_notes_updated_at",
  },
  { schema: "public", table: "assets", trigger: "trg_assets_updated_at" },
  {
    schema: "public",
    table: "configuration",
    trigger: "trg_configuration_updated_at",
  },
  {
    schema: "monitor",
    table: "collector_status",
    trigger: "trg_collector_status_updated_at",
  },
  { schema: "audit", table: "audit_logs", trigger: "trg_audit_logs_immutable" },
] as const;

const REQUIRED_CONSTRAINTS = [
  { table: "public.incidents", constraint: "chk_incidents_risk_score" },
  { table: "public.incidents", constraint: "chk_incidents_alert_count_nonnegative" },
  { table: "public.incidents", constraint: "chk_incidents_event_count_nonnegative" },
  { table: "public.incidents", constraint: "chk_incidents_resolved_at_status" },
  { table: "public.incidents", constraint: "chk_incidents_closed_at_status" },
  { table: "public.alerts", constraint: "chk_alerts_weight" },
  { table: "public.alerts", constraint: "chk_alerts_anomaly_score" },
  { table: "public.alerts", constraint: "chk_alerts_confidence" },
  { table: "public.rules", constraint: "chk_rules_weight" },
  { table: "public.assets", constraint: "chk_assets_criticality" },
  {
    table: "monitor.queue_metrics",
    constraint: "chk_queue_metrics_waiting_nonnegative",
  },
  {
    table: "monitor.queue_metrics",
    constraint: "chk_queue_metrics_active_nonnegative",
  },
  {
    table: "monitor.queue_metrics",
    constraint: "chk_queue_metrics_completed_nonnegative",
  },
  {
    table: "monitor.queue_metrics",
    constraint: "chk_queue_metrics_failed_nonnegative",
  },
  {
    table: "monitor.queue_metrics",
    constraint: "chk_queue_metrics_dead_lettered_nonnegative",
  },
] as const;

const REQUIRED_INCIDENT_INDEXES = [
  "idx_incidents_status_severity",
  "idx_incidents_severity_created",
  "idx_incidents_primary_entity",
  "idx_incidents_assigned_to",
  "idx_incidents_open_entity_time",
  "idx_incidents_risk_score",
  "idx_incidents_org_id",
] as const;

const REQUIRED_RUNTIME_ROLE_PRIVILEGES = [
  { relation: "public.users", privilege: "SELECT" },
  { relation: "public.users", privilege: "INSERT" },
  { relation: "public.users", privilege: "UPDATE" },
  { relation: "public.incidents", privilege: "SELECT" },
  { relation: "public.incidents", privilege: "INSERT" },
  { relation: "public.incidents", privilege: "UPDATE" },
  { relation: "public.rules", privilege: "SELECT" },
  { relation: "public.alerts", privilege: "SELECT" },
  { relation: "public.alerts", privilege: "INSERT" },
  { relation: "public.configuration", privilege: "SELECT" },
  { relation: "audit.audit_logs", privilege: "SELECT" },
  { relation: "audit.audit_logs", privilege: "INSERT" },
  { relation: "monitor.collector_status", privilege: "SELECT" },
  { relation: "monitor.queue_metrics", privilege: "SELECT" },
] as const;

const FORBIDDEN_RUNTIME_AUDIT_PRIVILEGES = ["UPDATE", "DELETE", "TRUNCATE"] as const;

interface CountResult {
  readonly count: string | number;
}

interface MigrationRow {
  readonly name: string;
}

export async function verifyPostgres(
  config: PostgresVerificationConfig,
): Promise<DatabaseComponentVerificationResult> {
  const startedAtDate = new Date();
  const startedAt = performance.now();
  const checks: DatabaseVerificationCheck[] = [];
  const client = createVerificationClient(config);
  const summary: Record<string, unknown> = {};

  try {
    await addTimedCheck(checks, "connectivity", async () => {
      await client.raw("SELECT 1 AS ok");
      return {
        status: "pass",
        message: "PostgreSQL connection succeeded.",
      };
    });

    await addTimedCheck(checks, "extensions", async () => {
      const rows = await client("pg_catalog.pg_extension")
        .select<{ extname: string }[]>("extname")
        .whereIn("extname", [...REQUIRED_EXTENSIONS]);
      const present = new Set(rows.map((row) => row.extname));
      const missing = REQUIRED_EXTENSIONS.filter((name) => !present.has(name));

      return missing.length === 0
        ? {
            status: "pass",
            message: "Required PostgreSQL extensions are installed.",
            details: { present: rows.map((row) => row.extname).sort() },
          }
        : {
            status: "fail",
            message: "Required PostgreSQL extensions are missing.",
            details: { missing },
          };
    });

    await addTimedCheck(checks, "schemas", async () => {
      const rows = await client("information_schema.schemata")
        .select<{ schema_name: string }[]>("schema_name")
        .whereIn("schema_name", [...REQUIRED_SCHEMAS]);
      const present = new Set(rows.map((row) => row.schema_name));
      const missing = REQUIRED_SCHEMAS.filter((name) => !present.has(name));

      return missing.length === 0
        ? {
            status: "pass",
            message: "Required PostgreSQL schemas exist.",
          }
        : {
            status: "fail",
            message: "Required PostgreSQL schemas are missing.",
            details: { missing },
          };
    });

    await verifyMigrationStatus(client, config, checks, summary);
    await verifyTables(client, checks);
    await verifyTriggers(client, checks);
    await verifyConstraints(client, checks);
    await verifyIncidentIndexes(client, checks);
    await verifySeeds(client, config, checks, summary);
    await verifyRuntimeRole(client, config, checks);
  } catch (error) {
    checks.push({
      name: "postgresql-verification",
      status: "fail",
      message: toSafeErrorMessage(error),
    });
  } finally {
    await client.destroy();
  }

  const finishedAt = new Date();
  const failed = checks.some((check) => check.status === "fail");

  return {
    component: "postgresql",
    success: !failed,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    checks,
    summary,
  };
}

function createVerificationClient(config: PostgresVerificationConfig): Knex {
  return knex({
    client: "pg",
    connection: {
      connectionString: config.connectionString,
      application_name: "trivikrama-database-verifier",
      connectionTimeoutMillis: config.connectionTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
    },
    pool: {
      min: 0,
      max: 1,
    },
    acquireConnectionTimeout: config.connectionTimeoutMs,
  });
}

async function verifyMigrationStatus(
  client: Knex,
  config: PostgresVerificationConfig,
  checks: DatabaseVerificationCheck[],
  summary: Record<string, unknown>,
): Promise<void> {
  await addTimedCheck(checks, "migration-files", async () => {
    const files = await readMigrationFiles(config.migrationsDirectory);
    summary.migrationFiles = files.length;

    return files.length > 0
      ? {
          status: "pass",
          message: "PostgreSQL migration files are present.",
          details: { count: files.length },
        }
      : {
          status: "fail",
          message: "No PostgreSQL migration files were found.",
          details: { migrationsDirectory: config.migrationsDirectory },
        };
  });

  await addTimedCheck(checks, "migration-table", async () => {
    const exists = await client.schema.withSchema("public").hasTable("knex_migrations");

    return exists
      ? {
          status: "pass",
          message: "Knex migration table exists.",
        }
      : {
          status: "fail",
          message: "Knex migration table does not exist.",
        };
  });

  await addTimedCheck(checks, "pending-migrations", async () => {
    const files = await readMigrationFiles(config.migrationsDirectory);
    const rows = await client("public.knex_migrations")
      .select<MigrationRow[]>("name")
      .orderBy("id", "asc");
    const completed = new Set(rows.map((row) => row.name));
    const pending = files.filter((file) => !completed.has(file));

    summary.completedMigrations = rows.length;
    summary.pendingMigrations = pending.length;

    return pending.length === 0
      ? {
          status: "pass",
          message: "All PostgreSQL migrations are applied.",
          details: { completed: rows.length },
        }
      : {
          status: "fail",
          message: "PostgreSQL has pending migrations.",
          details: { pending },
        };
  });
}

async function verifyTables(
  client: Knex,
  checks: DatabaseVerificationCheck[],
): Promise<void> {
  await addTimedCheck(checks, "required-tables", async () => {
    const rows = await client("information_schema.tables")
      .select<{ table_schema: string; table_name: string }[]>(
        "table_schema",
        "table_name",
      )
      .whereIn(
        "table_schema",
        Array.from(new Set(REQUIRED_TABLES.map((entry) => entry.schema))),
      );
    const present = new Set(
      rows.map((row) => `${row.table_schema}.${row.table_name}`),
    );
    const missing = REQUIRED_TABLES.map((entry) => `${entry.schema}.${entry.table}`).filter(
      (name) => !present.has(name),
    );

    return missing.length === 0
      ? {
          status: "pass",
          message: "Required PostgreSQL tables exist.",
        }
      : {
          status: "fail",
          message: "Required PostgreSQL tables are missing.",
          details: { missing },
        };
  });
}

async function verifyTriggers(
  client: Knex,
  checks: DatabaseVerificationCheck[],
): Promise<void> {
  await addTimedCheck(checks, "required-triggers", async () => {
    const rows = await client("information_schema.triggers")
      .select<{
        event_object_schema: string;
        event_object_table: string;
        trigger_name: string;
      }[]>("event_object_schema", "event_object_table", "trigger_name")
      .whereIn(
        "trigger_name",
        REQUIRED_TRIGGERS.map((entry) => entry.trigger),
      );
    const present = new Set(
      rows.map(
        (row) =>
          `${row.event_object_schema}.${row.event_object_table}.${row.trigger_name}`,
      ),
    );
    const missing = REQUIRED_TRIGGERS.map(
      (entry) => `${entry.schema}.${entry.table}.${entry.trigger}`,
    ).filter((name) => !present.has(name));

    return missing.length === 0
      ? {
          status: "pass",
          message: "Required PostgreSQL triggers exist.",
        }
      : {
          status: "fail",
          message: "Required PostgreSQL triggers are missing.",
          details: { missing },
        };
  });
}

async function verifyConstraints(
  client: Knex,
  checks: DatabaseVerificationCheck[],
): Promise<void> {
  await addTimedCheck(checks, "required-constraints", async () => {
    const rows = await client.raw<{
      rows: { table_schema: string; table_name: string; conname: string }[];
    }>(
      `
        SELECT
          namespace.nspname AS table_schema,
          class.relname AS table_name,
          constraint_record.conname
        FROM pg_catalog.pg_constraint AS constraint_record
        JOIN pg_catalog.pg_class AS class
          ON class.oid = constraint_record.conrelid
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
        WHERE constraint_record.conname = ANY(?::text[])
      `,
      [REQUIRED_CONSTRAINTS.map((entry) => entry.constraint)],
    );
    const present = new Set(
      rows.rows.map(
        (row) => `${row.table_schema}.${row.table_name}.${row.conname}`,
      ),
    );
    const missing = REQUIRED_CONSTRAINTS.map(
      (entry) => `${entry.table}.${entry.constraint}`,
    ).filter((name) => !present.has(name));

    return missing.length === 0
      ? {
          status: "pass",
          message: "Required PostgreSQL constraints exist.",
        }
      : {
          status: "fail",
          message: "Required PostgreSQL constraints are missing.",
          details: { missing },
        };
  });
}

async function verifyIncidentIndexes(
  client: Knex,
  checks: DatabaseVerificationCheck[],
): Promise<void> {
  await addTimedCheck(checks, "incident-indexes", async () => {
    const rows = await client("pg_catalog.pg_indexes")
      .select<{ indexname: string }[]>("indexname")
      .where({ schemaname: "public", tablename: "incidents" });
    const present = new Set(rows.map((row) => row.indexname));
    const missing = REQUIRED_INCIDENT_INDEXES.filter((name) => !present.has(name));

    return missing.length === 0
      ? {
          status: "pass",
          message: "Required incident query indexes exist.",
        }
      : {
          status: "fail",
          message: "Required incident query indexes are missing.",
          details: { missing },
        };
  });
}

async function verifySeeds(
  client: Knex,
  config: PostgresVerificationConfig,
  checks: DatabaseVerificationCheck[],
  summary: Record<string, unknown>,
): Promise<void> {
  await addTimedCheck(checks, "core-seed-status", async () => {
    const [users, adminUsers, builtinRules, configurationEntries] = await Promise.all([
      countRows(client, "public.users"),
      countRows(client, "public.users", { role: "admin", is_active: true }),
      countRows(client, "public.rules", { is_builtin: true }),
      countRows(client, "public.configuration"),
    ]);

    summary.users = users;
    summary.adminUsers = adminUsers;
    summary.builtinRules = builtinRules;
    summary.configurationEntries = configurationEntries;

    const failures: string[] = [];

    if (adminUsers < 1) failures.push("missing active admin user");
    if (builtinRules < config.expectedBuiltinRules) {
      failures.push(`expected at least ${config.expectedBuiltinRules} built-in rule(s)`);
    }
    if (configurationEntries < config.expectedConfigurationEntries) {
      failures.push(
        `expected at least ${config.expectedConfigurationEntries} configuration entries`,
      );
    }

    return failures.length === 0
      ? {
          status: "pass",
          message: "Core PostgreSQL seed data is present.",
          details: { users, adminUsers, builtinRules, configurationEntries },
        }
      : {
          status: "fail",
          message: "Core PostgreSQL seed data is incomplete.",
          details: { failures, users, adminUsers, builtinRules, configurationEntries },
        };
  });
}

async function verifyRuntimeRole(
  client: Knex,
  config: PostgresVerificationConfig,
  checks: DatabaseVerificationCheck[],
): Promise<void> {
  await addTimedCheck(checks, "runtime-role", async () => {
    const roleExists = await existsRuntimeRole(client, config.runtimeRole);

    if (!roleExists) {
      return {
        status: config.nodeEnv === "production" ? "fail" : "warn",
        message: `Runtime database role "${config.runtimeRole}" does not exist.`,
      };
    }

    const missingPrivileges: string[] = [];

    for (const required of REQUIRED_RUNTIME_ROLE_PRIVILEGES) {
      const hasPrivilege = await hasTablePrivilege(
        client,
        config.runtimeRole,
        required.relation,
        required.privilege,
      );

      if (!hasPrivilege) {
        missingPrivileges.push(`${required.relation}:${required.privilege}`);
      }
    }

    const forbiddenPrivileges: string[] = [];

    for (const privilege of FORBIDDEN_RUNTIME_AUDIT_PRIVILEGES) {
      const hasPrivilege = await hasTablePrivilege(
        client,
        config.runtimeRole,
        "audit.audit_logs",
        privilege,
      );

      if (hasPrivilege) {
        forbiddenPrivileges.push(`audit.audit_logs:${privilege}`);
      }
    }

    const status = missingPrivileges.length === 0 && forbiddenPrivileges.length === 0
      ? "pass"
      : "fail";

    return status === "pass"
      ? {
          status,
          message: "Runtime database role has expected least-privilege grants.",
        }
      : {
          status,
          message: "Runtime database role privileges are not correct.",
          details: { missingPrivileges, forbiddenPrivileges },
        };
  });
}

async function readMigrationFiles(migrationsDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();
}

async function countRows(
  client: Knex,
  tableName: string,
  where?: Record<string, unknown>,
): Promise<number> {
  const query = client(tableName).count<CountResult[]>({ count: "*" });

  if (where) {
    query.where(where);
  }

  const [row] = await query;
  return Number(row?.count ?? 0);
}

async function existsRuntimeRole(client: Knex, roleName: string): Promise<boolean> {
  const rows = await client("pg_catalog.pg_roles")
    .select<{ rolname: string }[]>("rolname")
    .where({ rolname: roleName })
    .limit(1);

  return rows.length > 0;
}

async function hasTablePrivilege(
  client: Knex,
  roleName: string,
  relation: string,
  privilege: string,
): Promise<boolean> {
  const result = await client.raw<{ rows: { has_privilege: boolean }[] }>(
    "SELECT has_table_privilege(?, ?, ?) AS has_privilege",
    [roleName, relation, privilege],
  );

  return Boolean(result.rows[0]?.has_privilege);
}

async function addTimedCheck(
  checks: DatabaseVerificationCheck[],
  name: string,
  fn: () => Promise<Omit<DatabaseVerificationCheck, "name" | "latencyMs">>,
): Promise<void> {
  const startedAt = performance.now();

  try {
    const result = await fn();
    checks.push({
      name,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...result,
    });
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      message: toSafeErrorMessage(error),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
}

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)([^@\s]+)(@)/giu, "$1****$3")
    .replace(/(password=)[^&\s]+/giu, "$1****");
}
