import "dotenv/config";

import { z } from "zod";

import {
  closePostgres,
  createPostgresClient,
} from "../database/postgres/client.js";
import { runDatabaseSeed } from "../database/seeds/seed-runner.js";
import type {
  InitialAdminSeedConfig,
  SeedProfile,
  SeedRunnerEnvironment,
} from "../database/seeds/seed.types.js";
import logger from "../shared/logger/index.js";

const seedEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    DATABASE_URL: z.string().min(1),
    POSTGRES_POOL_MIN: z.coerce.number().int().nonnegative().default(0),
    POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(1),
    POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    ADMIN_INITIAL_USERNAME: z.string().trim().min(1).default("admin"),
    ADMIN_INITIAL_EMAIL: z.string().trim().email().default("admin@example.local"),
    ADMIN_INITIAL_DISPLAY_NAME: z
      .string()
      .trim()
      .min(1)
      .default("Trivikrama Administrator"),
    ADMIN_INITIAL_PASSWORD: z.string().optional(),
    ADMIN_INITIAL_ORG_ID: z.string().trim().min(1).default("default"),
  })
  .refine((value) => value.POSTGRES_POOL_MIN <= value.POSTGRES_POOL_MAX, {
    message: "POSTGRES_POOL_MIN cannot exceed POSTGRES_POOL_MAX",
    path: ["POSTGRES_POOL_MIN"],
  });

const SUPPORTED_PROFILES: readonly SeedProfile[] = [
  "core",
  "development",
  "status",
];

async function main(): Promise<void> {
  const profile = parseSeedProfile(process.argv[2]);
  const environment = parseSeedEnvironment(profile);

  const client = createPostgresClient({
    connectionString: environment.databaseUrl,
    poolMin: environment.postgresPoolMin,
    poolMax: environment.postgresPoolMax,
    acquireConnectionTimeoutMs: environment.postgresAcquireConnectionTimeoutMs,
    applicationName: "trivikrama-seed-runner",
  });

  let seedError: unknown;

  try {
    const result = await runDatabaseSeed(client, {
      profile,
      environment,
    });

    logger.info(JSON.stringify(result, null, 2));

    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    seedError = error;
    throw error;
  } finally {
    try {
      await closePostgres(client);
    } catch (closeError: unknown) {
      if (seedError !== undefined) {
        logger.error("PostgreSQL cleanup also failed.", {
          error:
            closeError instanceof Error
              ? closeError.message
              : String(closeError),
        });
      } else {
        throw closeError;
      }
    }
  }
}

function parseSeedProfile(rawProfile: string | undefined): SeedProfile {
  const profile = rawProfile ?? "status";

  if (SUPPORTED_PROFILES.includes(profile as SeedProfile)) {
    return profile as SeedProfile;
  }

  throw new Error(
    `Unsupported seed profile "${profile}". Supported profiles: ${SUPPORTED_PROFILES.join(", ")}`,
  );
}

function parseSeedEnvironment(profile: SeedProfile): SeedRunnerEnvironment {
  const parsedEnv = seedEnvSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    throw new Error(
      `Seed environment validation failed: ${JSON.stringify(parsedEnv.error.format())}`,
    );
  }

  return {
    nodeEnv: parsedEnv.data.NODE_ENV,
    databaseUrl: parsedEnv.data.DATABASE_URL,
    postgresPoolMin: parsedEnv.data.POSTGRES_POOL_MIN,
    postgresPoolMax: parsedEnv.data.POSTGRES_POOL_MAX,
    postgresAcquireConnectionTimeoutMs:
      parsedEnv.data.POSTGRES_CONNECTION_TIMEOUT_MS,
    initialAdmin: buildInitialAdminConfig(profile, parsedEnv.data),
  };
}

function buildInitialAdminConfig(
  profile: SeedProfile,
  env: z.infer<typeof seedEnvSchema>,
): InitialAdminSeedConfig | undefined {
  if (profile === "status") {
    return undefined;
  }

  if (!env.ADMIN_INITIAL_PASSWORD) {
    throw new Error(
      "ADMIN_INITIAL_PASSWORD is required when running core or development database seeds",
    );
  }

  return {
    username: env.ADMIN_INITIAL_USERNAME,
    email: env.ADMIN_INITIAL_EMAIL,
    displayName: env.ADMIN_INITIAL_DISPLAY_NAME,
    password: env.ADMIN_INITIAL_PASSWORD,
    orgId: env.ADMIN_INITIAL_ORG_ID,
  };
}

main().catch((error: unknown) => {
  logSeedError(error);
  process.exitCode = 1;
});

function logSeedError(error: unknown): void {
  if (!(error instanceof Error)) {
    logger.error("Database seed failed.", {
      error: String(error),
    });
    return;
  }

  logger.error("Database seed failed.", {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: serializeErrorCause(error.cause),
  });
}

function serializeErrorCause(cause: unknown): unknown {
  if (!(cause instanceof Error)) {
    return cause === undefined ? undefined : String(cause);
  }

  const postgresError = cause as Error & {
    readonly code?: string;
    readonly detail?: string;
    readonly constraint?: string;
    readonly table?: string;
    readonly schema?: string;
    readonly column?: string;
    readonly routine?: string;
  };

  return {
    name: postgresError.name,
    message: postgresError.message,
    code: postgresError.code,
    detail: postgresError.detail,
    constraint: postgresError.constraint,
    schema: postgresError.schema,
    table: postgresError.table,
    column: postgresError.column,
    routine: postgresError.routine,
    stack: postgresError.stack,
  };
}
