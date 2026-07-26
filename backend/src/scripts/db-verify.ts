import { loadDatabaseVerificationConfig } from "../config/database-verification.env.js";
import { runFullDatabaseVerification } from "../database/verification/database-verifier.js";
import type { DatabaseVerificationCommand } from "../database/verification/verification.types.js";
import logger from "../shared/logger/index.js";

const VALID_COMMANDS = new Set<DatabaseVerificationCommand>(["status", "verify"]);

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const config = loadDatabaseVerificationConfig();
  const result = await runFullDatabaseVerification(command, config);
  const output = JSON.stringify(result, null, 2);

  if (result.success) {
    console.info(output);
    return;
  }

  console.error(output);
  process.exitCode = 1;
}

function parseCommand(value: string | undefined): DatabaseVerificationCommand {
  const command = value ?? "status";

  if (!VALID_COMMANDS.has(command as DatabaseVerificationCommand)) {
    throw new Error(
      `Unsupported database verification command "${command}". Use "status" or "verify".`,
    );
  }

  return command as DatabaseVerificationCommand;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  logger.error(
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
