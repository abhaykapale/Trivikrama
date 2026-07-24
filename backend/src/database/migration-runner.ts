export type MigrationRunnerOptions = {
  migrationsDir?: string;
  databaseUrl?: string;
};

export const runMigrations = async (
  _options?: MigrationRunnerOptions,
): Promise<void> => {
  throw new Error(
    "Database migrations are not implemented yet. Use the upcoming PostgreSQL migration runner.",
  );
};
