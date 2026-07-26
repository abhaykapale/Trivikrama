import config from "../config/index.js";
import {
  assertMongoRepositoryCoverage,
  assertPostgresRepositoryCoverage,
  closeMongoDb,
  closePostgres,
  connectMongoDb,
  createMongoDbClient,
  createMongoRepositories,
  createPostgresClient,
  createPostgresRepositories,
  MONGO_REPOSITORY_NAMES,
  POSTGRES_REPOSITORY_NAMES,
} from "../database/index.js";

async function main(): Promise<void> {
  const postgres = createPostgresClient({
    connectionString: config.database.DATABASE_URL,
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: config.database.postgres.connectionTimeoutMs,
  });

  const mongo = createMongoDbClient();

  try {
    await connectMongoDb(mongo, {
      uri: config.database.MONGODB_URI,
      minPoolSize: 0,
      maxPoolSize: Math.max(1, config.database.mongodb.poolSize),
      serverSelectionTimeoutMs:
        config.database.mongodb.serverSelectionTimeoutMs,
    });

    const repositories = createPostgresRepositories(postgres);
    const mongoRepositories = createMongoRepositories(mongo);

    assertPostgresRepositoryCoverage(repositories);
    assertMongoRepositoryCoverage(mongoRepositories);

    const [
      users,
      configuration,
      rules,
      audit,
      sessions,
      assets,
      collectorStatus,
      queueMetrics,
      incidents,
      alerts,
      incidentNotes,
      incidentEvents,
      normalizedEvents,
      aiResults,
      rawEventArchive,
    ] = await Promise.all([
      repositories.users.list({ limit: 5 }),
      repositories.configuration.list({ limit: 5 }),
      repositories.rules.list({ limit: 5 }),
      repositories.audit.list({ limit: 5 }),
      repositories.sessions.list({ limit: 5, includeRevoked: true }),
      repositories.assets.list({ limit: 5 }),
      repositories.collectorStatus.list({ limit: 5 }),
      repositories.queueMetrics.list({ limit: 5 }),
      repositories.incidents.list({ limit: 5 }),
      repositories.alerts.list({ limit: 5 }),
      repositories.incidentNotes.list({ limit: 5 }),
      repositories.incidentEvents.list({ limit: 5 }),
      mongoRepositories.normalizedEvents.list({ limit: 5 }),
      mongoRepositories.aiResults.list({ limit: 5 }),
      mongoRepositories.rawEventArchive.list({ limit: 5 }),
    ]);

    console.info(
      JSON.stringify(
        {
          success: true,
          repositoryFactory: {
            postgres: {
              expected: POSTGRES_REPOSITORY_NAMES.length,
              names: POSTGRES_REPOSITORY_NAMES,
            },
            mongodb: {
              expected: MONGO_REPOSITORY_NAMES.length,
              names: MONGO_REPOSITORY_NAMES,
            },
          },
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
            incidents: {
              sampleCount: incidents.items.length,
              hasMore: incidents.hasMore,
            },
            alerts: {
              sampleCount: alerts.items.length,
              hasMore: alerts.hasMore,
            },
            incidentNotes: {
              sampleCount: incidentNotes.items.length,
              hasMore: incidentNotes.hasMore,
            },
            incidentEvents: {
              sampleCount: incidentEvents.items.length,
              hasMore: incidentEvents.hasMore,
            },
            normalizedEvents: {
              sampleCount: normalizedEvents.items.length,
              hasMore: normalizedEvents.hasMore,
            },
            aiResults: {
              sampleCount: aiResults.items.length,
              hasMore: aiResults.hasMore,
            },
            rawEventArchive: {
              sampleCount: rawEventArchive.items.length,
              hasMore: rawEventArchive.hasMore,
            },
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.allSettled([closePostgres(postgres), closeMongoDb(mongo)]);
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
