import { loadRedisToolsConfig } from "../config/redis-tools.env.js";
import { runRedisVerification } from "../database/redis/verification.js";
import type { RedisVerificationCommand } from "../database/redis/verification.types.js";

const VALID_COMMANDS = new Set<RedisVerificationCommand>(["status", "verify"]);

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const toolsConfig = loadRedisToolsConfig();

  const result = await runRedisVerification(command, {
    nodeEnv: toolsConfig.nodeEnv,
    url: toolsConfig.redis.url,
    keyPrefix: toolsConfig.redis.keyPrefix,
    connectTimeoutMs: toolsConfig.redis.connectTimeoutMs,
    commandTimeoutMs: toolsConfig.redis.commandTimeoutMs,
    maxRetriesPerRequest: toolsConfig.redis.maxRetriesPerRequest,
    scanLimit: toolsConfig.redis.scanLimit,
    pubSubTimeoutMs: toolsConfig.redis.pubSubTimeoutMs,
  });

  const serializedResult = JSON.stringify(result, null, 2);

  if (result.success) {
    console.info(serializedResult);
    return;
  }

  console.error(serializedResult);
  process.exitCode = 1;
}

function parseCommand(value: string | undefined): RedisVerificationCommand {
  const command = value ?? "status";

  if (!VALID_COMMANDS.has(command as RedisVerificationCommand)) {
    throw new Error(
      `Unsupported Redis verification command "${command}". Use "status" or "verify".`,
    );
  }

  return command as RedisVerificationCommand;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    JSON.stringify(
      {
        success: false,
        error: message,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
