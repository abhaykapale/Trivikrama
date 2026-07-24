// import "../config/env.js";

import path from "node:path";
import env from "../config/env.js";
import logger from "../shared/logger/logger.js";
import {
  parseMigrationCommand,
  runPostgresMigrations,
  toSafeMigrationError,
} from "../database/migration-runner.js";



const backendRoot = process.cwd();

const migrationsDirectory = path.join(backendRoot, "migrations", "postgres");

const resolveDatabaseUrl = (): string => {
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ?? env.database.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run PostgreSQL migrations.");
  }

  return databaseUrl;
};

const main = async (): Promise<void> => {
  const command = parseMigrationCommand(process.argv[2]);
  const connectionString = resolveDatabaseUrl();

  logger.info("Starting PostgreSQL migration command.", {
    command,
    migrationsDirectory,
  });

  const result = await runPostgresMigrations(command, {
    connectionString,
    migrationsDirectory,
  });

  if (command === "status") {
    logger.info("PostgreSQL migration status loaded.", {
      completedCount: result.completed?.length ?? 0,
      pendingCount: result.pending?.length ?? 0,
      completed: result.completed ?? [],
      pending: result.pending ?? [],
    });

    return;
  }

  logger.info("PostgreSQL migration command completed.", {
    command,
    batch: result.batch,
    migrationsRun: result.migrations ?? [],
    migrationsRunCount: result.migrations?.length ?? 0,
  });
};

main().catch((error: unknown) => {
  logger.error("PostgreSQL migration command failed.", {
    error: toSafeMigrationError(error),
  });

  process.exitCode = 1;
});
