import type { Knex } from "knex";

import { createPostgresClient, closePostgres } from "../postgres/index.js";
import type {
  DatabaseMaintenanceCheck,
  DatabaseMaintenanceCommand,
  DatabaseMaintenanceConfig,
  DatabaseMaintenanceResult,
  MaintenancePartitionTarget,
  PartitionPlanItem,
  RetentionPlanItem,
  VacuumAnalyzeResult,
} from "./maintenance.types.js";

const MONTHLY_TARGETS: readonly Omit<MaintenancePartitionTarget, "futurePartitions">[] = [
  {
    schemaName: "audit",
    tableName: "audit_logs",
    partitionColumn: "created_at",
    cadence: "monthly",
  },
  {
    schemaName: "public",
    tableName: "incident_events",
    partitionColumn: "event_time",
    cadence: "monthly",
  },
];

const WEEKLY_TARGETS: readonly Omit<MaintenancePartitionTarget, "futurePartitions">[] = [
  {
    schemaName: "monitor",
    tableName: "queue_metrics",
    partitionColumn: "snapshot_at",
    cadence: "weekly",
  },
];

interface ExistingPartitionRow {
  readonly schema_name: string;
  readonly table_name: string;
  readonly partition_name: string;
  readonly from_value: string | null;
  readonly to_value: string | null;
}

interface ParentTableRow {
  readonly exists: boolean;
  readonly is_partitioned: boolean;
}

interface MaintenanceAccumulator {
  readonly checks: DatabaseMaintenanceCheck[];
  partitionsPlanned: number;
  partitionsCreated: number;
  retentionEligible: number;
  partitionsDropped: number;
  vacuumedTables: number;
}

export async function runPostgresMaintenance(
  command: DatabaseMaintenanceCommand,
  config: DatabaseMaintenanceConfig,
): Promise<DatabaseMaintenanceResult> {
  const startedAt = new Date();
  const accumulator: MaintenanceAccumulator = {
    checks: [],
    partitionsPlanned: 0,
    partitionsCreated: 0,
    retentionEligible: 0,
    partitionsDropped: 0,
    vacuumedTables: 0,
  };

  const client = createPostgresClient({
    connectionString: config.connectionString,
    acquireConnectionTimeoutMs: config.connectionTimeoutMs,
    applicationName: "trivikrama-db-maintenance",
  });

  try {
    await addTimedCheck(accumulator, "connectivity", async () => {
      await client.raw("SELECT 1;");
      return {
        name: "connectivity",
        status: "pass",
        message: "PostgreSQL maintenance connection succeeded.",
      };
    });

    await setMaintenanceTimeouts(client, config);

    if (command === "status" || command === "partitions" || command === "run") {
      const partitionPlan = await ensureFuturePartitions(
        client,
        config,
        command === "status",
      );
      accumulator.partitionsPlanned += partitionPlan.length;
      accumulator.partitionsCreated += partitionPlan.filter((item) => item.created).length;

      accumulator.checks.push({
        name: "partition-maintenance",
        status: partitionPlan.some((item) => !item.exists && !item.created)
          ? command === "status"
            ? "warn"
            : "fail"
          : "pass",
        message:
          command === "status"
            ? "PostgreSQL partition coverage inspected."
            : "PostgreSQL future partitions are available.",
        details: {
          planned: partitionPlan.length,
          created: partitionPlan.filter((item) => item.created).length,
          missing: partitionPlan.filter((item) => !item.exists && !item.created),
        },
      });
    }

    if (command === "status" || command === "retention" || command === "run") {
      const retentionPlan = await runRetentionMaintenance(
        client,
        config,
        command === "status" || !config.allowDestructiveRetention,
      );

      accumulator.retentionEligible += retentionPlan.filter(
        (item) => item.eligibleForDrop,
      ).length;
      accumulator.partitionsDropped += retentionPlan.filter((item) => item.dropped).length;

      accumulator.checks.push({
        name: "retention-maintenance",
        status:
          retentionPlan.some((item) => item.eligibleForDrop) &&
          !config.allowDestructiveRetention
            ? "warn"
            : "pass",
        message:
          retentionPlan.some((item) => item.eligibleForDrop) &&
          !config.allowDestructiveRetention
            ? "Old partitions are eligible for retention cleanup, but destructive retention is disabled."
            : "PostgreSQL retention cleanup inspected or applied.",
        details: {
          allowDestructiveRetention: config.allowDestructiveRetention,
          eligible: retentionPlan.filter((item) => item.eligibleForDrop).length,
          dropped: retentionPlan.filter((item) => item.dropped).length,
          partitions: retentionPlan,
        },
      });
    }

    if (command === "vacuum" || command === "run") {
      const vacuumResults = await runVacuumAnalyze(client, config);
      accumulator.vacuumedTables += vacuumResults.filter(
        (item) => item.status === "pass",
      ).length;
      accumulator.checks.push({
        name: "vacuum-analyze",
        status: vacuumResults.every((item) => item.status === "pass")
          ? "pass"
          : "warn",
        message: "VACUUM ANALYZE completed for configured PostgreSQL tables.",
        details: {
          results: vacuumResults,
        },
      });
    }
  } catch (error) {
    accumulator.checks.push({
      name: "maintenance-error",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await closePostgres(client);
  }

  const finishedAt = new Date();
  const failed = accumulator.checks.some((check) => check.status === "fail");

  return {
    command,
    nodeEnv: config.nodeEnv,
    success: !failed,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    checks: accumulator.checks,
    summary: {
      partitionsPlanned: accumulator.partitionsPlanned,
      partitionsCreated: accumulator.partitionsCreated,
      retentionEligible: accumulator.retentionEligible,
      partitionsDropped: accumulator.partitionsDropped,
      vacuumedTables: accumulator.vacuumedTables,
    },
  };
}

async function addTimedCheck(
  accumulator: MaintenanceAccumulator,
  name: string,
  operation: () => Promise<Omit<DatabaseMaintenanceCheck, "latencyMs">>,
): Promise<void> {
  const startedAt = Date.now();

  try {
    const result = await operation();
    accumulator.checks.push({
      ...result,
      name,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    accumulator.checks.push({
      name,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    });
  }
}

async function setMaintenanceTimeouts(
  client: Knex,
  config: DatabaseMaintenanceConfig,
): Promise<void> {
  await client.raw("SELECT set_config('statement_timeout', ?, false);", [
    String(config.statementTimeoutMs),
  ]);
  await client.raw("SELECT set_config('lock_timeout', ?, false);", [
    String(config.lockTimeoutMs),
  ]);
}

async function ensureFuturePartitions(
  client: Knex,
  config: DatabaseMaintenanceConfig,
  dryRun: boolean,
): Promise<readonly PartitionPlanItem[]> {
  const targets: readonly MaintenancePartitionTarget[] = [
    ...MONTHLY_TARGETS.map((target) => ({
      ...target,
      futurePartitions: config.futureMonthlyPartitions,
    })),
    ...WEEKLY_TARGETS.map((target) => ({
      ...target,
      futurePartitions: config.futureWeeklyPartitions,
    })),
  ];

  const items: PartitionPlanItem[] = [];

  for (const target of targets) {
    await assertPartitionedParentExists(client, target);
    const partitions = buildFuturePartitionWindows(target);
    const existing = await readExistingPartitions(client, target);
    const existingNames = new Set(existing.map((row) => row.partition_name));

    for (const partition of partitions) {
      const exists = existingNames.has(partition.partitionName);
      let created = false;

      if (!exists && !dryRun) {
        await createPartition(client, target, partition.partitionName, partition.from, partition.to);
        created = true;
      }

      items.push({
        parentTable: qualify(target.schemaName, target.tableName),
        partitionName: partition.partitionName,
        from: partition.from,
        to: partition.to,
        exists,
        created,
      });
    }
  }

  return items;
}

async function runRetentionMaintenance(
  client: Knex,
  config: DatabaseMaintenanceConfig,
  dryRun: boolean,
): Promise<readonly RetentionPlanItem[]> {
  const retentionTargets = [
    {
      schemaName: "audit",
      tableName: "audit_logs",
      cutoff: addUtcMonths(startOfUtcMonth(new Date()), -config.auditLogsRetentionMonths),
    },
    {
      schemaName: "public",
      tableName: "incident_events",
      cutoff: addUtcMonths(
        startOfUtcMonth(new Date()),
        -config.incidentEventsRetentionMonths,
      ),
    },
    {
      schemaName: "monitor",
      tableName: "queue_metrics",
      cutoff: addUtcDays(startOfUtcDay(new Date()), -config.queueMetricsRetentionDays),
    },
  ] as const;

  const items: RetentionPlanItem[] = [];

  for (const target of retentionTargets) {
    const partitions = await readExistingPartitions(client, {
      schemaName: target.schemaName,
      tableName: target.tableName,
    });

    for (const partition of partitions) {
      if (!partition.from_value || !partition.to_value) {
        continue;
      }

      const toDate = parseSqlDate(partition.to_value);
      const eligibleForDrop = toDate.getTime() < target.cutoff.getTime();
      let dropped = false;

      if (eligibleForDrop && !dryRun) {
        await dropPartition(client, partition.schema_name, partition.partition_name);
        dropped = true;
      }

      items.push({
        parentTable: qualify(target.schemaName, target.tableName),
        partitionName: qualify(partition.schema_name, partition.partition_name),
        from: partition.from_value,
        to: partition.to_value,
        cutoff: toSqlDate(target.cutoff),
        eligibleForDrop,
        dropped,
      });
    }
  }

  return items;
}

async function runVacuumAnalyze(
  client: Knex,
  config: DatabaseMaintenanceConfig,
): Promise<readonly VacuumAnalyzeResult[]> {
  const results: VacuumAnalyzeResult[] = [];

  for (const tableName of config.vacuumAnalyzeTables) {
    try {
      await assertKnownMaintenanceTable(tableName);
      await client.raw(`VACUUM (ANALYZE) ${quoteQualifiedIdentifier(tableName)};`);
      results.push({
        tableName,
        status: "pass",
        message: "VACUUM ANALYZE completed.",
      });
    } catch (error) {
      results.push({
        tableName,
        status: "warn",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function assertPartitionedParentExists(
  client: Knex,
  target: MaintenancePartitionTarget,
): Promise<void> {
  const result = await client.raw<{
    rows: readonly ParentTableRow[];
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          WHERE n.nspname = ?
            AND c.relname = ?
        ) AS "exists",
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          WHERE n.nspname = ?
            AND c.relname = ?
            AND c.relkind = 'p'
        ) AS "is_partitioned";
    `,
    [target.schemaName, target.tableName, target.schemaName, target.tableName],
  );

  const row = result.rows[0];

  if (!row?.exists) {
    throw new Error(`Partition parent ${qualify(target.schemaName, target.tableName)} does not exist.`);
  }

  if (!row.is_partitioned) {
    throw new Error(`Partition parent ${qualify(target.schemaName, target.tableName)} is not partitioned.`);
  }
}

async function readExistingPartitions(
  client: Knex,
  target: Pick<MaintenancePartitionTarget, "schemaName" | "tableName">,
): Promise<readonly ExistingPartitionRow[]> {
  const result = await client.raw<{ rows: ExistingPartitionRow[] }>(
    `
      SELECT
        child_ns.nspname AS schema_name,
        child.relname AS table_name,
        child.relname AS partition_name,
        (regexp_match(pg_get_expr(child.relpartbound, child.oid),
          $$FROM \('([^']+)'\) TO \('([^']+)'\)$$))[1] AS from_value,
        (regexp_match(pg_get_expr(child.relpartbound, child.oid),
          $$FROM \('([^']+)'\) TO \('([^']+)'\)$$))[2] AS to_value
      FROM pg_catalog.pg_inherits inh
      JOIN pg_catalog.pg_class parent
        ON parent.oid = inh.inhparent
      JOIN pg_catalog.pg_namespace parent_ns
        ON parent_ns.oid = parent.relnamespace
      JOIN pg_catalog.pg_class child
        ON child.oid = inh.inhrelid
      JOIN pg_catalog.pg_namespace child_ns
        ON child_ns.oid = child.relnamespace
      WHERE parent_ns.nspname = ?
        AND parent.relname = ?
      ORDER BY child.relname;
    `,
    [target.schemaName, target.tableName],
  );

  return result.rows;
}

function buildFuturePartitionWindows(
  target: MaintenancePartitionTarget,
): ReadonlyArray<{
  readonly partitionName: string;
  readonly from: string;
  readonly to: string;
}> {
  const windows: Array<{
    readonly partitionName: string;
    readonly from: string;
    readonly to: string;
  }> = [];

  if (target.cadence === "monthly") {
    const currentMonth = startOfUtcMonth(new Date());

    for (let offset = 0; offset <= target.futurePartitions; offset += 1) {
      const from = addUtcMonths(currentMonth, offset);
      const to = addUtcMonths(from, 1);
      windows.push({
        partitionName: buildMonthPartitionName(
          target.schemaName,
          target.tableName,
          from,
        ),
        from: toSqlDate(from),
        to: toSqlDate(to),
      });
    }

    return windows;
  }

  const currentWeek = startOfUtcWeek(new Date());

  for (let offset = 0; offset <= target.futurePartitions; offset += 1) {
    const from = addUtcDays(currentWeek, offset * 7);
    const to = addUtcDays(from, 7);
    windows.push({
      partitionName: buildWeekPartitionName(
        target.schemaName,
        target.tableName,
        from,
      ),
      from: toSqlDate(from),
      to: toSqlDate(to),
    });
  }

  return windows;
}

async function createPartition(
  client: Knex,
  target: MaintenancePartitionTarget,
  partitionName: string,
  from: string,
  to: string,
): Promise<void> {
  const parentTable = quoteQualifiedIdentifier(qualify(target.schemaName, target.tableName));
  const partitionTable = quoteQualifiedIdentifier(qualify(target.schemaName, partitionName));

  await client.raw(
    `
      CREATE TABLE IF NOT EXISTS ${partitionTable}
      PARTITION OF ${parentTable}
      FOR VALUES FROM (${quoteSqlLiteral(from)}) TO (${quoteSqlLiteral(to)});
    `,
  );

  await client.raw(
    `COMMENT ON TABLE ${partitionTable} IS ${quoteSqlLiteral(
      `${target.cadence} partition for ${qualify(
        target.schemaName,
        target.tableName,
      )}, partitioned by ${target.partitionColumn}.`,
    )};`,
  );
}

async function dropPartition(
  client: Knex,
  schemaName: string,
  partitionName: string,
): Promise<void> {
  await assertSafePartitionName(schemaName, partitionName);
  await client.raw(`DROP TABLE IF EXISTS ${quoteQualifiedIdentifier(qualify(schemaName, partitionName))};`);
}

async function assertSafePartitionName(
  schemaName: string,
  partitionName: string,
): Promise<void> {
  const safePatterns = [
    /^audit_logs_\d{4}_\d{2}$/u,
    /^incident_events_\d{4}_\d{2}$/u,
    /^queue_metrics_\d{4}_\d{2}_\d{2}$/u,
  ];

  const validSchema = ["audit", "public", "monitor"].includes(schemaName);
  const validName = safePatterns.some((pattern) => pattern.test(partitionName));

  if (!validSchema || !validName) {
    throw new Error(`Unsafe partition drop rejected for ${qualify(schemaName, partitionName)}.`);
  }
}

async function assertKnownMaintenanceTable(tableName: string): Promise<void> {
  const allowed = new Set([
    "public.incidents",
    "public.alerts",
    "public.rules",
    "public.users",
    "public.assets",
    "public.configuration",
    "monitor.collector_status",
    "monitor.queue_metrics",
  ]);

  if (!allowed.has(tableName)) {
    throw new Error(`VACUUM ANALYZE target ${tableName} is not allow-listed.`);
  }
}

function buildMonthPartitionName(
  _schemaName: string,
  tableName: string,
  monthStart: Date,
): string  {
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${tableName}_${year}_${month}`;
}

function buildWeekPartitionName(
  _schemaName: string,
  tableName: string,
  weekStart: Date,
): string {
  const year = weekStart.getUTCFullYear();
  const month = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
  const day = String(weekStart.getUTCDate()).padStart(2, "0");
  return `${tableName}_${year}_${month}_${day}`;
}

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function startOfUtcMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
}

function startOfUtcWeek(input: Date): Date {
  const date = startOfUtcDay(input);
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date;
}

function addUtcMonths(input: Date, months: number): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + months, 1));
}

function addUtcDays(input: Date, days: number): Date {
  const date = new Date(input.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function toSqlDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function parseSqlDate(input: string): Date {
  const [yearRaw, monthRaw, dayRaw] = input.slice(0, 10).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid SQL date "${input}".`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function qualify(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

function quoteQualifiedIdentifier(qualifiedIdentifier: string): string {
  return qualifiedIdentifier
    .split(".")
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(".");
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
