import { performance } from "node:perf_hooks";

import type { Knex } from "knex";

import type {
  ExecutableSeedProfile,
  SeedContext,
  SeedProfile,
  SeedRunResult,
  SeedRunnerEnvironment,
  SeedRunnerOptions,
  SeedStatusSnapshot,
  SeedStep,
  SeedStepResult,
} from "./seed.types.js";
import { seedDefaultConfiguration } from "./default-configuration.seed.js";
import { seedInitialAdministrator } from "./initial-admin.seed.js";
import { seedBuiltinRules } from "./builtin-rules.seed.js";
import { seedDevelopmentDemoData } from "./development-demo.seed.js";

const ADVISORY_LOCK_NAMESPACE = 86_060_818;
const ADVISORY_LOCK_KEY = 6;

const CORE_STEPS: readonly SeedStep[] = [
  {
    name: "initial-admin",
    run: seedInitialAdministrator,
  },
  {
    name: "default-configuration",
    run: seedDefaultConfiguration,
  },
  {
    name: "builtin-rules",
    run: seedBuiltinRules,
  },
];
const DEVELOPMENT_STEPS: readonly SeedStep[] = [
  {
    name: "development-demo-data",
    run: seedDevelopmentDemoData,
  },
];

export async function runDatabaseSeed(
  client: Knex,
  options: SeedRunnerOptions,
): Promise<SeedRunResult> {
  validateSeedOptions(options);
  enforceProfileSafety(options.profile, options.environment);

  const startedAt = new Date();
  const startedAtMs = performance.now();
  const steps: SeedStepResult[] = [];
  let status: SeedStatusSnapshot | undefined;

  if (options.profile === "status") {
    status = await readSeedStatus(client);

    return buildResult({
      profile: options.profile,
      environment: options.environment,
      startedAt,
      startedAtMs,
      steps,
      status,
    });
  }

  const executionProfile: ExecutableSeedProfile = options.profile;

  await client.transaction(async (trx) => {
    await acquireSeedAdvisoryLock(trx);

    const context: SeedContext = {
      profile: executionProfile,
      nodeEnv: options.environment.nodeEnv,
      trx,
      initialAdmin: requireInitialAdminConfig(options.environment),
    };

    for (const step of getSeedSteps(executionProfile)) {
      const stepResult = await runStep(step, context);
      steps.push(stepResult);

    }

    if (steps.length === 0) {
      steps.push({
        name: "seed-framework",
        status: "skipped",
        inserted: 0,
        updated: 0,
        skipped: 1,
        message:
          "Seed framework verified transaction and advisory lock. No data seed steps are registered yet.",
      });
    }

    status = await readSeedStatus(trx);
  });

  return buildResult({
    profile: options.profile,
    environment: options.environment,
    startedAt,
    startedAtMs,
    steps,
    status,
  });
}

export async function readSeedStatus(
  db: Knex | Knex.Transaction,
): Promise<SeedStatusSnapshot> {
  const [
    users,
    adminUsers,
    builtinRules,
    configurationEntries,
    assets,
    collectors,
    incidents,
    alerts,
    incidentEvents,
    queueMetrics,
  ] = await Promise.all([
    countRows(db, "public.users"),
    countRows(db, "public.users", { column: "role", value: "admin" }),
    countRows(db, "public.rules", { column: "is_builtin", value: true }),
    countRows(db, "public.configuration"),
    countRows(db, "public.assets"),
    countRows(db, "monitor.collector_status"),
    countRows(db, "public.incidents"),
    countRows(db, "public.alerts"),
    countRows(db, "public.incident_events"),
    countRows(db, "monitor.queue_metrics"),
  ]);

  return {
    users,
    adminUsers,
    builtinRules,
    configurationEntries,
    assets,
    collectors,
    incidents,
    alerts,
    incidentEvents,
    queueMetrics,
  };
}

function validateSeedOptions(options: SeedRunnerOptions): void {
  if (!isSeedProfile(options.profile)) {
    throw new Error(`Unsupported seed profile: ${String(options.profile)}`);
  }

  if (options.environment.databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required for database seeding");
  }

  if (options.environment.postgresPoolMin > options.environment.postgresPoolMax) {
    throw new Error("POSTGRES_POOL_MIN cannot exceed POSTGRES_POOL_MAX");
  }
}

function enforceProfileSafety(
  profile: SeedProfile,
  environment: SeedRunnerEnvironment,
): void {
  if (environment.nodeEnv === "production" && profile === "development") {
    throw new Error(
      "Refusing to run development seed profile in production. Use the core profile only.",
    );
  }
}

function requireInitialAdminConfig(
  environment: SeedRunnerEnvironment,
): NonNullable<SeedRunnerEnvironment["initialAdmin"]> {
  if (!environment.initialAdmin) {
    throw new Error(
      "Initial admin seed configuration is required. Set ADMIN_INITIAL_PASSWORD and optional ADMIN_INITIAL_USERNAME, ADMIN_INITIAL_EMAIL, ADMIN_INITIAL_DISPLAY_NAME, ADMIN_INITIAL_ORG_ID.",
    );
  }

  return environment.initialAdmin;
}

function isSeedProfile(value: unknown): value is SeedProfile {
  return value === "core" || value === "development" || value === "status";
}

function getSeedSteps(profile: ExecutableSeedProfile): readonly SeedStep[] {
  if (profile === "development") {
    return [...CORE_STEPS, ...DEVELOPMENT_STEPS];
  }

  return CORE_STEPS;
}

async function runStep(
  step: SeedStep,
  context: SeedContext,
): Promise<SeedStepResult> {
  try {
    return await step.run(context);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Seed step failed: ${step.name}: ${message}`,
      {
        cause: error,
      },
    );
  }
}

async function acquireSeedAdvisoryLock(trx: Knex.Transaction): Promise<void> {
  const result = await trx.raw<{ rows: { locked: boolean }[] }>(
    "select pg_try_advisory_xact_lock(?, ?) as locked",
    [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY],
  );
  const locked = result.rows[0]?.locked === true;

  if (!locked) {
    throw new Error(
      "Another database seed operation is already running. Try again after it completes.",
    );
  }
}

async function countRows(
  db: Knex | Knex.Transaction,
  tableName: string,
  filter?: { readonly column: string; readonly value: string | boolean },
): Promise<number> {
  const query = db(tableName).count<{ count: string | number }[]>({ count: "*" });

  if (filter) {
    query.where(filter.column, filter.value);
  }

  const [row] = await query;
  const value = row?.count ?? 0;

  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function buildResult(input: {
  readonly profile: SeedProfile;
  readonly environment: SeedRunnerEnvironment;
  readonly startedAt: Date;
  readonly startedAtMs: number;
  readonly steps: SeedStepResult[];
  readonly status?: SeedStatusSnapshot;
}): SeedRunResult {
  const failedSteps = input.steps.filter((step) => step.status === "failed");
  const finishedAt = new Date();

  return {
    profile: input.profile,
    nodeEnv: input.environment.nodeEnv,
    success: failedSteps.length === 0,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - input.startedAtMs)),
    status: input.status,
    steps: input.steps,
  };
}
