import type { Knex } from "knex";

/* ==========================================================================
 * Seed execution types
 * ========================================================================== */

export type SeedProfile = "core" | "development" | "status";

export type ExecutableSeedProfile = Exclude<SeedProfile, "status">;

export type SeedStepStatus = "skipped" | "success" | "failed";

export type SeedNodeEnvironment = "development" | "production" | "test";

/* ==========================================================================
 * Seed configuration
 * ========================================================================== */

export interface InitialAdminSeedConfig {
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly orgId: string;
}

export interface SeedRunnerEnvironment {
  readonly nodeEnv: SeedNodeEnvironment;
  readonly databaseUrl: string;
  readonly postgresPoolMin: number;
  readonly postgresPoolMax: number;
  readonly postgresAcquireConnectionTimeoutMs: number;
  readonly initialAdmin?: InitialAdminSeedConfig;
}

export interface SeedRunnerOptions {
  readonly profile: SeedProfile;
  readonly environment: SeedRunnerEnvironment;
}

/* ==========================================================================
 * Seed execution context
 * ========================================================================== */

export interface SeedContext {
  readonly profile: ExecutableSeedProfile;
  readonly nodeEnv: SeedNodeEnvironment;
  readonly trx: Knex.Transaction;
  readonly initialAdmin: InitialAdminSeedConfig;
}

/* ==========================================================================
 * Seed step results
 * ========================================================================== */

export interface SeedStepResult {
  readonly name: string;
  readonly status: SeedStepStatus;
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly message?: string;
}

export interface SeedStep {
  readonly name: string;
  run(context: SeedContext): Promise<SeedStepResult>;
}

export interface SeedInsertResult {
  readonly inserted: number;
  readonly skipped: number;
}

/* ==========================================================================
 * Seed status
 * ========================================================================== */

export interface SeedStatusSnapshot {
  readonly users: number;
  readonly adminUsers: number;
  readonly builtinRules: number;
  readonly configurationEntries: number;
  readonly assets: number;
  readonly collectors: number;
  readonly incidents: number;
  readonly alerts: number;
  readonly incidentEvents: number;
  readonly queueMetrics: number;
}

export interface SeedRunResult {
  readonly profile: SeedProfile;
  readonly nodeEnv: SeedNodeEnvironment;
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status?: SeedStatusSnapshot;
  readonly steps: SeedStepResult[];
}

/* ==========================================================================
 * public.users query types
 *
 * UserTableRow contains all columns currently used by seed queries in:
 * - SELECT
 * - WHERE
 * - ORDER BY
 *
 * Projection types contain only the columns returned by SELECT.
 * ========================================================================== */

export type UserRole = "admin" | "security_engineer" | "soc_analyst";

export interface UserTableRow {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly password_hash: string;
  readonly role: UserRole;
  readonly display_name: string | null;
  readonly is_active: boolean;
  readonly last_login_at: Date | null;
  readonly failed_login_count: number;
  readonly locked_until: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly org_id: string;
}

/**
 * Result of:
 *
 * SELECT id, username, email
 * FROM public.users
 */
export type ExistingAdminRow = Pick<UserTableRow, "id" | "username" | "email">;

/**
 * Result of:
 *
 * SELECT id, username, role
 * FROM public.users
 */
export type AdminActorRow = Pick<UserTableRow, "id" | "username" | "role">;

/**
 * Result of:
 *
 * SELECT id, username, email, role
 * FROM public.users
 */
export type ExistingUserConflictRow = Pick<
  UserTableRow,
  "id" | "username" | "email" | "role"
>;

/* ==========================================================================
 * public.rules query types
 *
 * RuleLookupRow contains every rules-table column currently used by lookup
 * queries. Projection types contain only selected result columns.
 * ========================================================================== */

export interface RuleLookupRow {
  readonly id: string;
  readonly name: string;
  readonly is_builtin: boolean;
  readonly org_id: string;
}

/**
 * Result used by development-demo.seed.ts:
 *
 * SELECT id, name
 * FROM public.rules
 */
export type RuleRow = Pick<RuleLookupRow, "id" | "name">;

/**
 * Result used by builtin-rules.seed.ts:
 *
 * SELECT id, name, is_builtin, org_id
 * FROM public.rules
 */
export type ExistingRuleRow = Pick<
  RuleLookupRow,
  "id" | "name" | "is_builtin" | "org_id"
>;

/* ==========================================================================
 * public.configuration query types
 * ========================================================================== */

export interface ExistingConfigurationRow {
  readonly key: string;
}

/* ==========================================================================
 * Generic seed query types
 * ========================================================================== */

export interface SeedIdRow {
  readonly id: string;
}

export interface CollectorIdRow {
  readonly collector_id: string;
}

export interface SeedCountRow {
  readonly count: string | number;
}
