import type { Knex } from "knex";

import type { AdminActorRow, RuleLookupRow, RuleRow, SeedContext, SeedStepResult, UserTableRow } from "./seed.types.js";

const DEVELOPMENT_DEMO_STEP_NAME = "development-demo-data";

const DEMO_ADMIN_NOTE =
  "Development seed data for local dashboards and API smoke tests. Do not run this profile in production.";

const BASE_TIME = new Date("2026-07-26T05:30:00.000Z");

const DEMO_ASSETS = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    name: "web-server-01",
    asset_type: "server",
    ip_address: "10.0.0.10",
    hostname: "web-server-01",
    criticality: 0.9,
    owner: "Platform Engineering",
    department: "Production",
    tags: ["linux", "dmz", "web"],
    metadata: {
      environment: "development-demo",
      os: "ubuntu-22.04",
      business_service: "customer-portal",
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    name: "db-server-03",
    asset_type: "server",
    ip_address: "10.0.0.30",
    hostname: "db-server-03",
    criticality: 0.95,
    owner: "Database Operations",
    department: "Production",
    tags: ["postgresql", "database", "crown-jewel"],
    metadata: {
      environment: "development-demo",
      engine: "postgresql",
      business_service: "transaction-store",
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    name: "vpn-gateway-01",
    asset_type: "network_device",
    ip_address: "10.0.0.5",
    hostname: "vpn-gateway-01",
    criticality: 0.85,
    owner: "Network Security",
    department: "Infrastructure",
    tags: ["vpn", "edge", "remote-access"],
    metadata: {
      environment: "development-demo",
      vendor: "generic-firewall",
      exposure: "internet-facing",
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    name: "analyst-ws-17",
    asset_type: "workstation",
    ip_address: "10.0.20.17",
    hostname: "analyst-ws-17",
    criticality: 0.5,
    owner: "SOC Operations",
    department: "Security",
    tags: ["windows", "workstation", "soc"],
    metadata: {
      environment: "development-demo",
      os: "windows-11",
      user: "soc.analyst",
    },
  },
] as const;

const DEMO_COLLECTORS = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    collector_id: "collector-linux-dmz-01",
    status: "online",
    last_heartbeat_at: offsetMinutes(BASE_TIME, -1),
    heartbeat_data: {
      source_types: ["syslog", "file"],
      version: "dev-seed",
      watched_directory: "/var/siem/collector/dmz",
    },
    files_processed: 128,
    events_collected: 58420,
    events_dropped: 0,
    errors_count: 0,
    cpu_percent: 18.4,
    memory_mb: 142.5,
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    collector_id: "collector-windows-ad-01",
    status: "degraded",
    last_heartbeat_at: offsetMinutes(BASE_TIME, -9),
    heartbeat_data: {
      source_types: ["windows_etw"],
      version: "dev-seed",
      warning: "Heartbeat delayed beyond normal interval",
    },
    files_processed: 74,
    events_collected: 26110,
    events_dropped: 12,
    errors_count: 3,
    cpu_percent: 42.1,
    memory_mb: 310.25,
  },
  {
    id: "00000000-0000-4000-8000-000000000303",
    collector_id: "collector-edge-fw-01",
    status: "offline",
    last_heartbeat_at: offsetMinutes(BASE_TIME, -45),
    heartbeat_data: {
      source_types: ["syslog"],
      version: "dev-seed",
      last_error: "No heartbeat received within development demo window",
    },
    files_processed: 22,
    events_collected: 9300,
    events_dropped: 0,
    errors_count: 1,
    cpu_percent: null,
    memory_mb: null,
  },
] as const;

const DEMO_QUEUE_METRICS = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    queue_name: "siem-pipeline",
    waiting: 234,
    active: 4,
    completed: 18420,
    failed: 12,
    dead_lettered: 2,
    is_paused: false,
    snapshot_at: offsetMinutes(BASE_TIME, -30),
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    queue_name: "siem-pipeline",
    waiting: 91,
    active: 4,
    completed: 18975,
    failed: 13,
    dead_lettered: 2,
    is_paused: false,
    snapshot_at: offsetMinutes(BASE_TIME, -15),
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    queue_name: "siem-pipeline",
    waiting: 42,
    active: 2,
    completed: 19310,
    failed: 13,
    dead_lettered: 2,
    is_paused: false,
    snapshot_at: BASE_TIME,
  },
] as const;

const DEMO_INCIDENTS = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    title: "HIGH - SSH Brute Force on web-server-01",
    description:
      "Multiple failed SSH login attempts from 192.168.1.100 against root on web-server-01, grouped into one actionable incident for development testing.",
    status: "open",
    severity: "high",
    risk_score: 78.5,
    source: "both",
    score_breakdown: {
      rule_weight: 0.8,
      ml_confidence: 0.92,
      asset_criticality: 0.9,
      alert_density: 0.6,
      kill_chain_bonus: 0.67,
      formula:
        "Development demo score based on documented composite risk factors.",
    },
    primary_entity: "192.168.1.100",
    entity_type: "src_ip",
    entities: [
      { type: "src_ip", value: "192.168.1.100" },
      { type: "user", value: "root" },
      { type: "host", value: "web-server-01" },
    ],
    kill_chain_stages: ["credential_access"],
    alert_count: 2,
    event_count: 12,
    first_event_at: offsetMinutes(BASE_TIME, -25),
    last_event_at: offsetMinutes(BASE_TIME, -10),
  },
  {
    id: "00000000-0000-4000-8000-000000000502",
    title: "HIGH - Unusual Admin Login on db-server-03",
    description:
      "AI anomaly detection flagged an administrator login outside normal working hours from a new source IP.",
    status: "investigating",
    severity: "high",
    risk_score: 62.3,
    source: "ai",
    score_breakdown: {
      rule_weight: null,
      ml_confidence: 0.89,
      asset_criticality: 0.95,
      alert_density: 0.1,
      kill_chain_bonus: 0,
      formula: "Development demo score for AI-only anomaly investigation.",
    },
    primary_entity: "admin",
    entity_type: "user",
    entities: [
      { type: "user", value: "admin" },
      { type: "src_ip", value: "203.0.113.44" },
      { type: "host", value: "db-server-03" },
    ],
    kill_chain_stages: ["initial_access"],
    alert_count: 1,
    event_count: 1,
    first_event_at: offsetMinutes(BASE_TIME, -80),
    last_event_at: offsetMinutes(BASE_TIME, -80),
  },
  {
    id: "00000000-0000-4000-8000-000000000503",
    title: "MEDIUM - Collector Heartbeat Delay",
    description:
      "The Windows Active Directory collector is degraded and has reported dropped events in the development demo environment.",
    status: "open",
    severity: "medium",
    risk_score: 45.1,
    source: "rule",
    score_breakdown: {
      rule_weight: 0.5,
      ml_confidence: null,
      asset_criticality: 0.85,
      alert_density: 0.15,
      kill_chain_bonus: 0,
      formula: "Development demo operational-monitoring incident.",
    },
    primary_entity: "collector-windows-ad-01",
    entity_type: "collector",
    entities: [
      { type: "collector", value: "collector-windows-ad-01" },
      { type: "source_type", value: "windows_etw" },
    ],
    kill_chain_stages: [],
    alert_count: 1,
    event_count: 0,
    first_event_at: offsetMinutes(BASE_TIME, -9),
    last_event_at: offsetMinutes(BASE_TIME, -9),
  },
] as const;

const DEMO_EVENT_LINKS = [
  {
    id: "00000000-0000-4000-8000-000000000701",
    incident_id: "00000000-0000-4000-8000-000000000501",
    event_id: "mongo-demo-normalized-event-ssh-001",
    event_time: offsetMinutes(BASE_TIME, -25),
    class_uid: 3002,
    severity_id: 3,
    src_ip: "192.168.1.100",
    dst_ip: "10.0.0.10",
    username: "root",
    hostname: "web-server-01",
  },
  {
    id: "00000000-0000-4000-8000-000000000702",
    incident_id: "00000000-0000-4000-8000-000000000501",
    event_id: "mongo-demo-normalized-event-ssh-002",
    event_time: offsetMinutes(BASE_TIME, -23),
    class_uid: 3002,
    severity_id: 3,
    src_ip: "192.168.1.100",
    dst_ip: "10.0.0.10",
    username: "root",
    hostname: "web-server-01",
  },
  {
    id: "00000000-0000-4000-8000-000000000703",
    incident_id: "00000000-0000-4000-8000-000000000501",
    event_id: "mongo-demo-normalized-event-ssh-003",
    event_time: offsetMinutes(BASE_TIME, -10),
    class_uid: 3002,
    severity_id: 4,
    src_ip: "192.168.1.100",
    dst_ip: "10.0.0.10",
    username: "root",
    hostname: "web-server-01",
  },
  {
    id: "00000000-0000-4000-8000-000000000704",
    incident_id: "00000000-0000-4000-8000-000000000502",
    event_id: "mongo-demo-normalized-event-login-001",
    event_time: offsetMinutes(BASE_TIME, -80),
    class_uid: 3002,
    severity_id: 4,
    src_ip: "203.0.113.44",
    dst_ip: "10.0.0.30",
    username: "admin",
    hostname: "db-server-03",
  },
] as const;



export async function seedDevelopmentDemoData(
  context: SeedContext,
): Promise<SeedStepResult> {
  assertDevelopmentProfile(context);

  const adminActor = await findSeedAdminActor(context.trx, context.initialAdmin.orgId);
  const sshRule = await findBuiltinSshRule(context.trx, context.initialAdmin.orgId);

  if (!adminActor) {
    throw new Error(
      "Development demo seed requires an active admin user. Run the core seed first.",
    );
  }

  if (!sshRule) {
    throw new Error(
      "Development demo seed requires the built-in SSH Brute Force rule. Run DB-06B.4 first.",
    );
  }

  let inserted = 0;
  let skipped = 0;

  const assetsResult = await seedAssets(context.trx, context.initialAdmin.orgId);
  inserted += assetsResult.inserted;
  skipped += assetsResult.skipped;

  const collectorsResult = await seedCollectorStatus(
    context.trx,
    context.initialAdmin.orgId,
  );
  inserted += collectorsResult.inserted;
  skipped += collectorsResult.skipped;

  const queueMetricsResult = await seedQueueMetrics(context.trx);
  inserted += queueMetricsResult.inserted;
  skipped += queueMetricsResult.skipped;

  const incidentsResult = await seedIncidents(
    context.trx,
    context.initialAdmin.orgId,
    adminActor.id,
  );
  inserted += incidentsResult.inserted;
  skipped += incidentsResult.skipped;

  const alertsResult = await seedAlerts(
    context.trx,
    context.initialAdmin.orgId,
    sshRule,
  );
  inserted += alertsResult.inserted;
  skipped += alertsResult.skipped;

  const eventLinksResult = await seedIncidentEventLinks(context.trx);
  inserted += eventLinksResult.inserted;
  skipped += eventLinksResult.skipped;

  const notesResult = await seedIncidentNotes(
    context.trx,
    adminActor.id,
  );
  inserted += notesResult.inserted;
  skipped += notesResult.skipped;

  if (inserted > 0) {
    await writeDevelopmentSeedAuditLog(context, adminActor, inserted, skipped);
    inserted += 1;
  }

  return {
    name: DEVELOPMENT_DEMO_STEP_NAME,
    status: inserted > 0 ? "success" : "skipped",
    inserted,
    updated: 0,
    skipped,
    message:
      inserted > 0
        ? "Development demo data inserted for local dashboard/API verification. This data is not for production."
        : "Development demo data already exists. Existing demo rows are preserved.",
  };
}

function assertDevelopmentProfile(context: SeedContext): void {
  if (context.profile !== "development") {
    throw new Error("Development demo seed can only run under the development profile.");
  }

  if (context.nodeEnv === "production") {
    throw new Error("Refusing to run development demo seed when NODE_ENV=production.");
  }
}

async function seedAssets(
  trx: Knex.Transaction,
  orgId: string,
): Promise<{ inserted: number; skipped: number }> {
  const existingIds = await findExistingIds(trx, "public.assets", DEMO_ASSETS.map((asset) => asset.id));
  const rowsToInsert = DEMO_ASSETS.filter((asset) => !existingIds.has(asset.id));

  if (rowsToInsert.length > 0) {
    await trx("public.assets").insert(
      rowsToInsert.map((asset) => ({
        ...asset,
        tags: JSON.stringify([...asset.tags]),
        metadata: JSON.stringify(asset.metadata),
        is_active: true,
        org_id: orgId,
      })),
    );
  }

  return {
    inserted: rowsToInsert.length,
    skipped: DEMO_ASSETS.length - rowsToInsert.length,
  };
}

async function seedCollectorStatus(
  trx: Knex.Transaction,
  orgId: string,
): Promise<{ inserted: number; skipped: number }> {
  const existingCollectors = await trx<{ collector_id: string }>(
    "monitor.collector_status",
  )
    .select("collector_id")
    .whereIn(
      "collector_id",
      DEMO_COLLECTORS.map((collector) => collector.collector_id),
    );
  const existingCollectorIds = new Set(
    existingCollectors.map((collector) => collector.collector_id),
  );
  const rowsToInsert = DEMO_COLLECTORS.filter(
    (collector) => !existingCollectorIds.has(collector.collector_id),
  );

  if (rowsToInsert.length > 0) {
    await trx("monitor.collector_status").insert(
      rowsToInsert.map((collector) => ({
        ...collector,
        heartbeat_data: JSON.stringify(collector.heartbeat_data),
        org_id: orgId,
      })),
    );
  }

  return {
    inserted: rowsToInsert.length,
    skipped: DEMO_COLLECTORS.length - rowsToInsert.length,
  };
}

async function seedQueueMetrics(
  trx: Knex.Transaction,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const metric of DEMO_QUEUE_METRICS) {
    const exists = await trx("monitor.queue_metrics")
      .select("id")
      .where({ id: metric.id, snapshot_at: metric.snapshot_at })
      .first();

    if (exists) {
      skipped += 1;
      continue;
    }

    await trx("monitor.queue_metrics").insert(metric);
    inserted += 1;
  }

  return { inserted, skipped };
}

async function seedIncidents(
  trx: Knex.Transaction,
  orgId: string,
  assignedTo: string,
): Promise<{ inserted: number; skipped: number }> {
  const existingIds = await findExistingIds(
    trx,
    "public.incidents",
    DEMO_INCIDENTS.map((incident) => incident.id),
  );
  const rowsToInsert = DEMO_INCIDENTS.filter(
    (incident) => !existingIds.has(incident.id),
  );

  if (rowsToInsert.length > 0) {
    await trx("public.incidents").insert(
      rowsToInsert.map((incident) => ({
        ...incident,
        score_breakdown: JSON.stringify(incident.score_breakdown),
        entities: JSON.stringify(incident.entities),
        kill_chain_stages: JSON.stringify([...incident.kill_chain_stages]),
        assigned_to: incident.status === "investigating" ? assignedTo : null,
        org_id: orgId,
      })),
    );
  }

  return {
    inserted: rowsToInsert.length,
    skipped: DEMO_INCIDENTS.length - rowsToInsert.length,
  };
}

async function seedAlerts(
  trx: Knex.Transaction,
  orgId: string,
  sshRule: RuleRow,
): Promise<{ inserted: number; skipped: number }> {
  const alerts = buildDemoAlerts(sshRule.id);
  const existingIds = await findExistingIds(
    trx,
    "public.alerts",
    alerts.map((alert) => alert.id),
  );
  const rowsToInsert = alerts.filter((alert) => !existingIds.has(alert.id));

  if (rowsToInsert.length > 0) {
    await trx("public.alerts").insert(
      rowsToInsert.map((alert) => ({
        ...alert,
        tags: JSON.stringify(alert.tags),
        metadata: JSON.stringify(alert.metadata),
        matched_event_ids: JSON.stringify(alert.matched_event_ids),
        shap_values: alert.shap_values ? JSON.stringify(alert.shap_values) : null,
        org_id: orgId,
      })),
    );
  }

  return {
    inserted: rowsToInsert.length,
    skipped: alerts.length - rowsToInsert.length,
  };
}

async function seedIncidentEventLinks(
  trx: Knex.Transaction,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const link of DEMO_EVENT_LINKS) {
    const exists = await trx("public.incident_events")
      .select("id")
      .where({
        incident_id: link.incident_id,
        event_id: link.event_id,
        event_time: link.event_time,
      })
      .first();

    if (exists) {
      skipped += 1;
      continue;
    }

    await trx("public.incident_events").insert(link);
    inserted += 1;
  }

  return { inserted, skipped };
}

async function seedIncidentNotes(
  trx: Knex.Transaction,
  authorId: string,
): Promise<{ inserted: number; skipped: number }> {
  const notes = [
    {
      id: "00000000-0000-4000-8000-000000000801",
      incident_id: "00000000-0000-4000-8000-000000000501",
      author_id: authorId,
      content:
        "Development note: verify SSH brute-force correlation, alert grouping, and incident detail rendering.",
    },
    {
      id: "00000000-0000-4000-8000-000000000802",
      incident_id: "00000000-0000-4000-8000-000000000502",
      author_id: authorId,
      content:
        "Development note: validate AI-only incident presentation and SHAP explanation placeholders.",
    },
  ] as const;

  const existingIds = await findExistingIds(
    trx,
    "public.incident_notes",
    notes.map((note) => note.id),
  );
  const rowsToInsert = notes.filter((note) => !existingIds.has(note.id));

  if (rowsToInsert.length > 0) {
    await trx("public.incident_notes").insert(rowsToInsert);
  }

  return {
    inserted: rowsToInsert.length,
    skipped: notes.length - rowsToInsert.length,
  };
}

async function writeDevelopmentSeedAuditLog(
  context: SeedContext,
  adminActor: AdminActorRow,
  insertedRows: number,
  skippedRows: number,
): Promise<void> {
  await context.trx("audit.audit_logs").insert({
    action: "incident_create",
    actor_id: adminActor.id,
    actor_username: adminActor.username,
    actor_role: adminActor.role,
    target_type: "development_seed",
    target_id: "DB-06C",
    target_name: "Development demo data",
    details: {
      source: "database_seed",
      seed_step: DEVELOPMENT_DEMO_STEP_NAME,
      warning: DEMO_ADMIN_NOTE,
      inserted_rows: insertedRows,
      skipped_rows: skippedRows,
    },
    new_state: {
      asset_count: DEMO_ASSETS.length,
      collector_count: DEMO_COLLECTORS.length,
      queue_metric_count: DEMO_QUEUE_METRICS.length,
      incident_count: DEMO_INCIDENTS.length,
      event_link_count: DEMO_EVENT_LINKS.length,
    },
    org_id: context.initialAdmin.orgId,
  });
}

async function findExistingIds(
  trx: Knex.Transaction,
  tableName: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  const rows = await trx<{ id: string }>(tableName)
    .select("id")
    .whereIn("id", ids);

  return new Set(rows.map((row) => row.id));
}

async function findSeedAdminActor(
  trx: Knex.Transaction,
  orgId: string,
): Promise<AdminActorRow | undefined> {
  return trx<UserTableRow, AdminActorRow[]>("public.users")
    .select("id", "username", "role")
    .where({
      role: "admin",
      org_id: orgId,
      is_active: true,
    })
    .orderBy("created_at", "asc")
    .first();
}

async function findBuiltinSshRule(
  trx: Knex.Transaction,
  orgId: string,
): Promise<RuleRow | undefined> {
  return trx<RuleLookupRow>("public.rules")
    .select("id", "name")
    .where({ name: "SSH Brute Force", org_id: orgId, is_builtin: true })
    .first();
}

function buildDemoAlerts(sshRuleId: string) {
  return [
    {
      id: "00000000-0000-4000-8000-000000000601",
      incident_id: "00000000-0000-4000-8000-000000000501",
      alert_type: "rule",
      rule_id: sshRuleId,
      rule_name: "SSH Brute Force",
      matched_condition: "count(src_endpoint.ip) >= 10 within 5m",
      anomaly_score: null,
      confidence: null,
      threat_category: null,
      model_version: null,
      shap_values: null,
      severity: "high",
      weight: 0.8,
      tags: ["attack.credential_access", "attack.t1110"],
      metadata: {
        source: "development_seed",
        count: 12,
        threshold: 10,
        timewindow: "5m",
      },
      matched_event_ids: [
        "mongo-demo-normalized-event-ssh-001",
        "mongo-demo-normalized-event-ssh-002",
        "mongo-demo-normalized-event-ssh-003",
      ],
      created_at: offsetMinutes(BASE_TIME, -10),
    },
    {
      id: "00000000-0000-4000-8000-000000000602",
      incident_id: "00000000-0000-4000-8000-000000000501",
      alert_type: "ai",
      rule_id: null,
      rule_name: null,
      matched_condition: null,
      anomaly_score: 0.89,
      confidence: 0.92,
      threat_category: "brute_force",
      model_version: "dev-seed-v1",
      shap_values: {
        baseValue: 0.32,
        features: [
          { name: "events_per_minute_src_ip", value: 45, shapValue: 0.28 },
          { name: "failed_login_count_10min", value: 12, shapValue: 0.22 },
        ],
      },
      severity: "high",
      weight: 0.75,
      tags: ["ai.anomaly", "auth.frequency"],
      metadata: {
        source: "development_seed",
        usedFallback: false,
      },
      matched_event_ids: ["mongo-demo-normalized-event-ssh-003"],
      created_at: offsetMinutes(BASE_TIME, -9),
    },
    {
      id: "00000000-0000-4000-8000-000000000603",
      incident_id: "00000000-0000-4000-8000-000000000502",
      alert_type: "ai",
      rule_id: null,
      rule_name: null,
      matched_condition: null,
      anomaly_score: 0.86,
      confidence: 0.89,
      threat_category: "unusual_login",
      model_version: "dev-seed-v1",
      shap_values: {
        baseValue: 0.27,
        features: [
          { name: "hour_of_day", value: 2, shapValue: 0.19 },
          { name: "new_source_ip", value: 1, shapValue: 0.31 },
        ],
      },
      severity: "high",
      weight: 0.7,
      tags: ["ai.anomaly", "auth.unusual_login"],
      metadata: {
        source: "development_seed",
        usedFallback: false,
      },
      matched_event_ids: ["mongo-demo-normalized-event-login-001"],
      created_at: offsetMinutes(BASE_TIME, -78),
    },
    {
      id: "00000000-0000-4000-8000-000000000604",
      incident_id: "00000000-0000-4000-8000-000000000503",
      alert_type: "rule",
      rule_id: null,
      rule_name: "Collector Heartbeat Delay",
      matched_condition: "last_heartbeat_at older than expected interval",
      anomaly_score: null,
      confidence: null,
      threat_category: null,
      model_version: null,
      shap_values: null,
      severity: "medium",
      weight: 0.5,
      tags: ["collector.health", "pipeline.monitoring"],
      metadata: {
        source: "development_seed",
        collector_id: "collector-windows-ad-01",
      },
      matched_event_ids: [],
      created_at: offsetMinutes(BASE_TIME, -8),
    },
  ] as const;
}

function offsetMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
