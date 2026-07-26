import { loadDatabaseMaintenanceConfig } from "../config/database-maintenance.env.js";
import { runPostgresMaintenance } from "../database/maintenance/postgres-maintenance.js";
import type { DatabaseMaintenanceCommand } from "../database/maintenance/maintenance.types.js";

const VALID_COMMANDS = new Set<DatabaseMaintenanceCommand>([
  "status",
  "partitions",
  "retention",
  "vacuum",
  "run",
]);

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const config = loadDatabaseMaintenanceConfig();
  const result = await runPostgresMaintenance(command, config);
  const output = JSON.stringify(result, null, 2);

  if (result.success) {
    console.info(output);
    return;
  }

  console.error(output);
  process.exitCode = 1;
}

function parseCommand(value: string | undefined): DatabaseMaintenanceCommand {
  const command = value ?? "status";

  if (!VALID_COMMANDS.has(command as DatabaseMaintenanceCommand)) {
    throw new Error(
      `Unsupported database maintenance command "${command}". Use status, partitions, retention, vacuum, or run.`,
    );
  }

  return command as DatabaseMaintenanceCommand;
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
