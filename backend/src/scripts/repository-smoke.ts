import config from "../config/index.js";
import {
  closePostgres,
  createPostgresClient,
  createPostgresRepositories,
} from "../database/index.js";

async function main(): Promise<void> {
  const postgres = createPostgresClient({
    connectionString: config.database.DATABASE_URL,
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: config.database.postgres.connectionTimeoutMs,
  });

  try {
    const repositories = createPostgresRepositories(postgres);

    const [users, configuration, rules, audit, sessions, assets, collectorStatus, queueMetrics] =
      await Promise.all([
        repositories.users.list({ limit: 5 }),
        repositories.configuration.list({ limit: 5 }),
        repositories.rules.list({ limit: 5 }),
        repositories.audit.list({ limit: 5 }),
        repositories.sessions.list({ limit: 5, includeRevoked: true }),
        repositories.assets.list({ limit: 5 }),
        repositories.collectorStatus.list({ limit: 5 }),
        repositories.queueMetrics.list({ limit: 5 }),
      ]);

    console.info(
      JSON.stringify(
        {
          success: true,
          repositories: {
            users: {
              sampleCount: users.items.length,
              hasMore: users.hasMore,
            },
            configuration: {
              sampleCount: configuration.items.length,
              hasMore: configuration.hasMore,
            },
            rules: {
              sampleCount: rules.items.length,
              hasMore: rules.hasMore,
            },
            audit: {
              sampleCount: audit.items.length,
              hasMore: audit.hasMore,
            },
            sessions: {
              sampleCount: sessions.items.length,
              hasMore: sessions.hasMore,
            },
            assets: {
              sampleCount: assets.items.length,
              hasMore: assets.hasMore,
            },
            collectorStatus: {
              sampleCount: collectorStatus.items.length,
              hasMore: collectorStatus.hasMore,
            },
            queueMetrics: {
              sampleCount: queueMetrics.items.length,
              hasMore: queueMetrics.hasMore,
            },
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
