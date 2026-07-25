import fs from "node:fs/promises";
import knex, { type Knex } from "knex";

export type MigrationCommand = "latest" | "rollback" | "status";

export interface MigrationRunnerOptions {
  connectionString: string;
  migrationsDirectory: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleInTransactionSessionTimeoutMs?: number;
}

interface PendingMigration {
  file: string;
  directory: string;
}

export interface MigrationCommandResult {
  command: MigrationCommand;
  migrationsDirectory: string;
  batch?: number;
  migrations?: string[];
  completed?: string[];
  pending?: PendingMigration[];
}

interface SafeError {
  name: string;
  message: string;
}


const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 60_000;

const MIGRATION_TABLE_NAME = "knex_migrations";

const MIGRATION_LOAD_EXTENSIONS = [".js"];

const MIGRATION_SCHEMA_NAME = "public";

/**
 * We intentionally load JavaScript migration files.
 *
 * Why?
 * - The backend itself is TypeScript.
 * - The compiled production app runs JavaScript from dist/.
 * - Deployment copies backend/migrations/ as files.
 * - If migration files are TypeScript, production would need ts-node/tsx.
 *
 * So the migration runner is TypeScript, but actual migration files will be
 * plain JavaScript ESM files such as:
 *
 * migrations/postgres/001_extensions_schemas_enums.js
 */
const buildMigrationConfig = (
  migrationsDirectory: string,
): Knex.MigratorConfig => ({
  directory: migrationsDirectory,
  tableName: MIGRATION_TABLE_NAME,
  schemaName: MIGRATION_SCHEMA_NAME,
  loadExtensions: MIGRATION_LOAD_EXTENSIONS,
});

const assertMigrationsDirectoryExists = async (
  migrationsDirectory: string,
): Promise<void> => {
  const stat = await fs.stat(migrationsDirectory).catch(() => null);

  if (!stat || !stat.isDirectory()) {
    throw new Error(
      `PostgreSQL migrations directory does not exist: ${migrationsDirectory}`,
    );
  }
};


const createMigrationClient = (options: MigrationRunnerOptions): Knex => {
  return knex({
    client: "pg",

    connection: {
      connectionString: options.connectionString,
      application_name: "trivikrama-migration-runner",
      connectionTimeoutMillis:
        options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      statement_timeout:
        options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        options.idleInTransactionSessionTimeoutMs ??
        DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
    },

    searchPath: ["public"],

    pool: {
      min: 0,
      max: 1,
    },

    acquireConnectionTimeout:
      options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  });
};

export const parseMigrationCommand = (
  value: string | undefined,
): MigrationCommand => {
  if (!value || value === "latest") {
    return "latest";
  }

  if (value === "rollback") {
    return "rollback";
  }

  if (value === "status") {
    return "status";
  }

  throw new Error(
    `Invalid migration command "${value}". Expected one of: latest, rollback, status.`,
  );
};

export const runPostgresMigrations = async (
  command: MigrationCommand,
  options: MigrationRunnerOptions,
): Promise<MigrationCommandResult> => {
  await assertMigrationsDirectoryExists(options.migrationsDirectory);

  const client = createMigrationClient(options);
  const migrationConfig = buildMigrationConfig(options.migrationsDirectory);

  try {
    await client.raw("SELECT 1");

    if (command === "status") {
      const [completed, pending] = await client.migrate.list(migrationConfig);

      return {
        command,
        migrationsDirectory: options.migrationsDirectory,
        completed,
        pending,
      };
    }

    if (command === "rollback") {
      const [batch, migrations] = await client.migrate.rollback(
        migrationConfig,
        false,
      );

      return {
        command,
        migrationsDirectory: options.migrationsDirectory,
        batch,
        migrations,
      };
    }

    const [batch, migrations] = await client.migrate.latest(migrationConfig);

    return {
      command,
      migrationsDirectory: options.migrationsDirectory,
      batch,
      migrations,
    };
  } finally {
    await client.destroy();
  }
};

const redactSensitiveText = (value: string): string => {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)([^@\s]+)(@)/gi, "$1****$3")
    .replace(/(password=)[^&\s]+/gi, "$1****");
};

export const toSafeMigrationError = (error: unknown): SafeError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
    };
  }

  return {
    name: "UnknownError",
    message: "Unknown migration error.",
  };
};
