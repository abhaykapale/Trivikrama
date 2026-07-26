import { loadMongoDbToolsConfig } from "../config/mongodb-tools.env.js";
import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../database/mongodb/index.js";
import { runMongoDbBootstrap } from "../database/mongodb/bootstrap.js";
import type { MongoBootstrapCommand } from "../database/mongodb/bootstrap.types.js";
import logger from "../shared/logger/index.js";

function parseCommand(argv: readonly string[]): MongoBootstrapCommand {
  const command = argv[2] ?? "status";

  if (command === "apply" || command === "status") {
    return command;
  }

  throw new Error(
    `Unsupported MongoDB bootstrap command: ${command}. Use "apply" or "status".`,
  );
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  const config = loadMongoDbToolsConfig();
  const client = createMongoDbClient();

  try {
    await connectMongoDb(client, {
      uri: config.uri,
      minPoolSize: 0,
      maxPoolSize: config.poolSize,
      serverSelectionTimeoutMs: config.serverSelectionTimeoutMs,
      connectTimeoutMs: config.connectTimeoutMs,
      socketTimeoutMs: config.socketTimeoutMs,
    });

    const result = await runMongoDbBootstrap(client, command);
    const logMethod = result.success ? console.info : console.error;

    logMethod(JSON.stringify(result, null, 2));

    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    await closeMongoDb(client);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  logger.error(
    JSON.stringify(
      {
        success: false,
        error: {
          message,
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
