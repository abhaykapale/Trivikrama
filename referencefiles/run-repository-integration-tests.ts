import {
  cleanupRepositoryIntegrationData,
  closeRepositoryIntegrationTestContext,
  createRepositoryIntegrationTestContext,
  runIntegrationTestCases,
} from "./test-harness.js";
import { mongoRepositoryIntegrationTests } from "./mongodb-repositories.integration.js";
import { postgresRepositoryIntegrationTests } from "./postgres-repositories.integration.js";
import { unitOfWorkIntegrationTests } from "./unit-of-work.integration.js";

const testCases = [
  ...postgresRepositoryIntegrationTests,
  ...mongoRepositoryIntegrationTests,
  ...unitOfWorkIntegrationTests,
] as const;

async function main(): Promise<void> {
  const startedAt = Date.now();
  const context = await createRepositoryIntegrationTestContext();

  try {
    await cleanupRepositoryIntegrationData(context);
    const results = await runIntegrationTestCases(context, testCases);
    const failed = results.filter((result) => result.status === "fail");

    const output = {
      success: failed.length === 0,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      totals: {
        tests: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
      },
      results,
    };

    console.log(JSON.stringify(output, null, 2));

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeRepositoryIntegrationTestContext(context);
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
