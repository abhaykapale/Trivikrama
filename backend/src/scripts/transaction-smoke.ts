import config from "../config/index.js";
import {
  closePostgres,
  createPostgresClient,
  createPostgresUnitOfWork,
} from "../database/index.js";

async function main(): Promise<void> {
  const postgres = createPostgresClient({
    connectionString: config.database.DATABASE_URL,
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: config.database.postgres.connectionTimeoutMs,
  });

  try {
    const unitOfWork = createPostgresUnitOfWork(postgres, {
      defaultIsolationLevel: "read committed",
      defaultStatementTimeoutMs: 5_000,
      defaultLockTimeoutMs: 2_000,
      defaultRetry: {
        maxAttempts: 3,
        baseDelayMs: 25,
        maxDelayMs: 100,
      },
    });

    const result = await unitOfWork.execute(
      async ({ repositories, attempt }) => {
        const [users, configuration, rules] = await Promise.all([
          repositories.users.list({ limit: 1 }),
          repositories.configuration.list({ limit: 1 }),
          repositories.rules.list({ limit: 1 }),
        ]);

        return {
          attempt,
          users: users.items.length,
          configuration: configuration.items.length,
          rules: rules.items.length,
        };
      },
      {
        readOnly: true,
        isolationLevel: "read committed",
        statementTimeoutMs: 5_000,
        lockTimeoutMs: 2_000,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 25,
          maxDelayMs: 50,
        },
      },
    );

    console.info(
      JSON.stringify(
        {
          success: true,
          transaction: {
            mode: "read-only",
            repositoriesBound: true,
            attempt: result.attempt,
          },
          samples: {
            users: result.users,
            configuration: result.configuration,
            rules: result.rules,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await closePostgres(postgres);
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
