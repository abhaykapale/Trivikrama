/**
 * DB-04: Resolve partitioning before creating high-volume tables.
 *
 * Owns:
 * - audit.audit_logs        partitioned monthly by created_at
 * - public.incident_events  partitioned monthly by event_time
 * - monitor.queue_metrics   partitioned weekly by snapshot_at
 *
 * This migration assumes the following already exist:
 * - schemas: audit, monitor
 * - enums: audit_action, user_role
 * - tables: public.users, public.incidents
 */

const HIGH_VOLUME_TABLES = Object.freeze([
  { schema: "audit", table: "audit_logs" },
  { schema: "public", table: "incident_events" },
  { schema: "monitor", table: "queue_metrics" },
]);

const REQUIRED_SCHEMAS = Object.freeze(["audit", "monitor"]);

const REQUIRED_ENUM_TYPES = Object.freeze([
  { schema: "public", type: "audit_action" },
  { schema: "public", type: "user_role" },
]);

/**
 * Only internally generated identifiers are passed here.
 *
 * PostgreSQL parameters cannot be used for table or column names,
 * so identifiers must be validated and quoted separately.
 */
function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }

  return `"${value}"`;
}

function quoteQualifiedIdentifier(value) {
  return value
    .split(".")
    .map((part) => quoteIdentifier(part))
    .join(".");
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function startOfUtcMonth(input) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
}

function addUtcMonths(input, numberOfMonths) {
  return new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + numberOfMonths, 1),
  );
}

/**
 * Weeks start on Monday at 00:00 UTC.
 */
function startOfUtcWeek(input) {
  const date = new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
  );

  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return date;
}

function addUtcDays(input, numberOfDays) {
  const date = new Date(input.getTime());
  date.setUTCDate(date.getUTCDate() + numberOfDays);
  return date;
}

function toSqlDate(input) {
  return input.toISOString().slice(0, 10);
}

function buildMonthPartitionName(qualifiedPrefix, monthStart) {
  const nameParts = qualifiedPrefix.split(".");
  const tablePrefix = nameParts.pop();
  const schemaPrefix = nameParts.length > 0 ? `${nameParts.join(".")}.` : "";

  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");

  return `${schemaPrefix}${tablePrefix}_${year}_${month}`;
}

function buildWeekPartitionName(qualifiedPrefix, weekStart) {
  const nameParts = qualifiedPrefix.split(".");
  const tablePrefix = nameParts.pop();
  const schemaPrefix = nameParts.length > 0 ? `${nameParts.join(".")}.` : "";

  const year = weekStart.getUTCFullYear();
  const month = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
  const day = String(weekStart.getUTCDate()).padStart(2, "0");

  return `${schemaPrefix}${tablePrefix}_${year}_${month}_${day}`;
}

async function assertSchemaExists(knex, schemaName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace
        WHERE nspname = ?
      ) AS "exists";
    `,
    [schemaName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-04 requires PostgreSQL schema "${schemaName}" to exist. ` +
        "Check the extensions/schemas/enums migration.",
    );
  }
}

async function assertRequiredTableExists(knex, schemaName, tableName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = ?
          AND c.relname = ?
          AND c.relkind IN ('r', 'p')
      ) AS "exists";
    `,
    [schemaName, tableName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-04 requires ${schemaName}.${tableName} to exist. ` +
        "Check the relational migration order.",
    );
  }
}

async function assertRequiredEnumExists(knex, schemaName, typeName) {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n
          ON n.oid = t.typnamespace
        WHERE n.nspname = ?
          AND t.typname = ?
          AND t.typtype = 'e'
      ) AS "exists";
    `,
    [schemaName, typeName],
  );

  if (!result.rows[0]?.exists) {
    throw new Error(
      `DB-04 requires enum ${schemaName}.${typeName} to exist. ` +
        "Check the extensions/schemas/enums migration.",
    );
  }
}

/**
 * Protects against accidentally creating an ordinary table before DB-04.
 *
 * PostgreSQL relkind:
 * - r = ordinary table
 * - p = partitioned table
 */
async function assertNoUnpartitionedHighVolumeTables(knex) {
  for (const { schema, table } of HIGH_VOLUME_TABLES) {
    const result = await knex.raw(
      `
        SELECT c.relkind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = ?
          AND c.relname = ?;
      `,
      [schema, table],
    );

    const relkind = result.rows[0]?.relkind;

    if (relkind && relkind !== "p") {
      throw new Error(
        `${schema}.${table} already exists but is not partitioned. ` +
          "DB-04 must own creation of this high-volume table.",
      );
    }
  }
}

async function createMonthlyPartitions(
  knex,
  qualifiedParentTable,
  qualifiedPartitionPrefix,
  partitionColumn,
) {
  const currentMonth = startOfUtcMonth(new Date());
  const parentTable = quoteQualifiedIdentifier(qualifiedParentTable);

  /*
   * Bootstrap partitions:
   * - one previous month
   * - current month
   * - three future months
   *
   * A future partition-maintenance job must continue creating partitions.
   */
  for (let offset = -1; offset <= 3; offset += 1) {
    const from = addUtcMonths(currentMonth, offset);
    const to = addUtcMonths(from, 1);

    const qualifiedPartitionName = buildMonthPartitionName(
      qualifiedPartitionPrefix,
      from,
    );

    const partitionTable = quoteQualifiedIdentifier(qualifiedPartitionName);

    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${partitionTable}
      PARTITION OF ${parentTable}
      FOR VALUES FROM (${quoteSqlLiteral(toSqlDate(from))})
      TO (${quoteSqlLiteral(toSqlDate(to))});
    `);

    await knex.raw(`
      COMMENT ON TABLE ${partitionTable} IS
      ${quoteSqlLiteral(
        `Monthly partition for ${qualifiedParentTable}, partitioned by ${partitionColumn}`,
      )};
    `);
  }
}

async function createWeeklyPartitions(
  knex,
  qualifiedParentTable,
  qualifiedPartitionPrefix,
  partitionColumn,
) {
  const currentWeek = startOfUtcWeek(new Date());
  const parentTable = quoteQualifiedIdentifier(qualifiedParentTable);

  /*
   * Bootstrap partitions:
   * - one previous week
   * - current week
   * - eight future weeks
   */
  for (let offset = -1; offset <= 8; offset += 1) {
    const from = addUtcDays(currentWeek, offset * 7);
    const to = addUtcDays(from, 7);

    const qualifiedPartitionName = buildWeekPartitionName(
      qualifiedPartitionPrefix,
      from,
    );

    const partitionTable = quoteQualifiedIdentifier(qualifiedPartitionName);

    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${partitionTable}
      PARTITION OF ${parentTable}
      FOR VALUES FROM (${quoteSqlLiteral(toSqlDate(from))})
      TO (${quoteSqlLiteral(toSqlDate(to))});
    `);

    await knex.raw(`
      COMMENT ON TABLE ${partitionTable} IS
      ${quoteSqlLiteral(
        `Weekly partition for ${qualifiedParentTable}, partitioned by ${partitionColumn}`,
      )};
    `);
  }
}

async function grantRuntimePrivilegesIfRoleExists(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'trivikrama_app'
      ) THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE public.incident_events
          TO trivikrama_app;

        REVOKE UPDATE, DELETE, TRUNCATE
          ON TABLE audit.audit_logs
          FROM trivikrama_app;

        GRANT SELECT, INSERT
          ON TABLE audit.audit_logs
          TO trivikrama_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
          ON TABLE monitor.queue_metrics
          TO trivikrama_app;
      END IF;
    END
    $$;
  `);
}

async function up(knex) {
  for (const schemaName of REQUIRED_SCHEMAS) {
    await assertSchemaExists(knex, schemaName);
  }

  for (const { schema, type } of REQUIRED_ENUM_TYPES) {
    await assertRequiredEnumExists(knex, schema, type);
  }

  await assertRequiredTableExists(knex, "public", "users");
  await assertRequiredTableExists(knex, "public", "incidents");

  await assertNoUnpartitionedHighVolumeTables(knex);

  await knex.raw(`
    CREATE TABLE audit.audit_logs (
      id                UUID NOT NULL DEFAULT uuid_generate_v4(),
      action            audit_action NOT NULL,

      actor_id          UUID
        REFERENCES public.users(id)
        ON DELETE SET NULL,

      actor_username    VARCHAR(100),
      actor_role        user_role,
      ip_address        INET,

      target_type       VARCHAR(100),
      target_id         VARCHAR(255),
      target_name       VARCHAR(255),

      details           JSONB NOT NULL DEFAULT '{}'::jsonb,
      previous_state    JSONB,
      new_state         JSONB,

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      org_id            VARCHAR(100) NOT NULL DEFAULT 'default',

      CONSTRAINT pk_audit_logs
        PRIMARY KEY (id, created_at)
    )
    PARTITION BY RANGE (created_at);

    COMMENT ON TABLE audit.audit_logs IS
      'Immutable audit trail partitioned monthly by created_at.';
  `);

  await knex.raw(`
    CREATE TABLE public.incident_events (
      id                UUID NOT NULL DEFAULT uuid_generate_v4(),

      incident_id       UUID NOT NULL
        REFERENCES public.incidents(id)
        ON DELETE CASCADE,

      event_id          VARCHAR(255) NOT NULL,
      event_time        TIMESTAMPTZ NOT NULL,

      class_uid         INTEGER,
      severity_id       INTEGER,
      src_ip            INET,
      dst_ip            INET,
      username          VARCHAR(255),
      hostname          VARCHAR(255),

      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT pk_incident_events
        PRIMARY KEY (id, event_time),

      CONSTRAINT uq_incident_events_incident_event_time
        UNIQUE (incident_id, event_id, event_time)
    )
    PARTITION BY RANGE (event_time);

    COMMENT ON TABLE public.incident_events IS
      'Incident-to-event junction table partitioned monthly by event_time.';
  `);

  await knex.raw(`
    CREATE TABLE monitor.queue_metrics (
      id                UUID NOT NULL DEFAULT uuid_generate_v4(),
      queue_name        VARCHAR(100) NOT NULL,

      waiting           INTEGER NOT NULL DEFAULT 0,
      active            INTEGER NOT NULL DEFAULT 0,
      completed         BIGINT NOT NULL DEFAULT 0,
      failed            BIGINT NOT NULL DEFAULT 0,
      dead_lettered     BIGINT NOT NULL DEFAULT 0,

      is_paused         BOOLEAN NOT NULL DEFAULT FALSE,
      snapshot_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT pk_queue_metrics
        PRIMARY KEY (id, snapshot_at)
    )
    PARTITION BY RANGE (snapshot_at);

    COMMENT ON TABLE monitor.queue_metrics IS
      'Queue-health snapshots partitioned weekly by snapshot_at.';
  `);

  await createMonthlyPartitions(
    knex,
    "audit.audit_logs",
    "audit.audit_logs",
    "created_at",
  );

  await createMonthlyPartitions(
    knex,
    "public.incident_events",
    "public.incident_events",
    "event_time",
  );

  await createWeeklyPartitions(
    knex,
    "monitor.queue_metrics",
    "monitor.queue_metrics",
    "snapshot_at",
  );

  /*
   * PostgreSQL creates corresponding indexes on each existing partition
   * when an index is created on the partitioned parent.
   */
  await knex.raw(`
    CREATE INDEX idx_audit_logs_created
      ON audit.audit_logs (created_at DESC);

    CREATE INDEX idx_audit_logs_action_created
      ON audit.audit_logs (action, created_at DESC);

    CREATE INDEX idx_audit_logs_actor_created
      ON audit.audit_logs (actor_id, created_at DESC);

    CREATE INDEX idx_audit_logs_target_created
      ON audit.audit_logs (
        target_type,
        target_id,
        created_at DESC
      );

    CREATE INDEX idx_incident_events_incident_time
      ON public.incident_events (
        incident_id,
        event_time DESC
      );

    CREATE INDEX idx_incident_events_event_id
      ON public.incident_events (event_id);

    CREATE INDEX idx_incident_events_src_ip
      ON public.incident_events (src_ip)
      WHERE src_ip IS NOT NULL;

    CREATE INDEX idx_incident_events_dst_ip
      ON public.incident_events (dst_ip)
      WHERE dst_ip IS NOT NULL;

    CREATE INDEX idx_incident_events_username_time
      ON public.incident_events (
        username,
        event_time DESC
      )
      WHERE username IS NOT NULL;

    CREATE INDEX idx_queue_metrics_queue_snapshot
      ON monitor.queue_metrics (
        queue_name,
        snapshot_at DESC
      );
  `);

  await grantRuntimePrivilegesIfRoleExists(knex);
}

async function down(knex) {
  /*
   * Dropping a partitioned parent drops its attached partitions.
   *
   * The order matters:
   * - incident_events depends on incidents
   * - audit_logs depends on users
   */
  await knex.raw(`
    DROP TABLE IF EXISTS monitor.queue_metrics;
    DROP TABLE IF EXISTS public.incident_events;
    DROP TABLE IF EXISTS audit.audit_logs;
  `);
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
