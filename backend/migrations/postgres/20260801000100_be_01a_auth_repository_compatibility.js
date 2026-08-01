/**
 * BE-01A: authentication compatibility extension.
 *
 * This is a forward-only, non-destructive migration. It adds the audit actions
 * required by the authentication foundation and verifies the indexes already
 * mandated by DB-001. It does not recreate tables or replace existing indexes.
 */

const REQUIRED_AUDIT_ACTIONS = ["login_failed", "session_revoked"];

/**
 * @param {import("knex").Knex} knex
 * @param {string} schemaName
 * @param {string} tableName
 * @returns {Promise<Array<{ indexname: string, indexdef: string }>>}
 */
async function loadIndexes(knex, schemaName, tableName) {
  const result = await knex.raw(
    `
      SELECT indexname, indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname = ?
        AND tablename = ?
    `,
    [schemaName, tableName],
  );

  return result.rows;
}

/**
 * @param {Array<{ indexname: string, indexdef: string }>} indexes
 * @param {string} description
 * @param {string[]} requiredFragments
 */
function assertIndex(indexes, description, requiredFragments) {
  const normalizedFragments = requiredFragments.map(normalizeSql);
  const matchingIndex = indexes.find(({ indexdef }) => {
    const normalizedDefinition = normalizeSql(indexdef);
    return normalizedFragments.every((fragment) =>
      normalizedDefinition.includes(fragment),
    );
  });

  if (!matchingIndex) {
    throw new Error(
      `BE-01A requires ${description}. Apply the database foundation migrations before this compatibility migration.`,
    );
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeSql(value) {
  return value
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\bon\s+only\s+/gu, "on ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * @param {import("knex").Knex} knex
 */
async function addAuditActions(knex) {
  for (const action of REQUIRED_AUDIT_ACTIONS) {
    await knex.raw(
      `ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS ${quoteLiteral(action)}`,
    );
  }
}

/**
 * @param {import("knex").Knex} knex
 */
async function verifyAuthIndexes(knex) {
  const [userIndexes, sessionIndexes, auditIndexes] = await Promise.all([
    loadIndexes(knex, "public", "users"),
    loadIndexes(knex, "public", "sessions"),
    loadIndexes(knex, "audit", "audit_logs"),
  ]);

  assertIndex(
    userIndexes,
    "an index for public.users(username, org_id)",
    ["on public.users", "(username, org_id)"],
  );

  assertIndex(
    sessionIndexes,
    "an index for public.sessions(jwt_id)",
    ["on public.sessions", "(jwt_id)"],
  );

  assertIndex(
    sessionIndexes,
    "an expiry-cleanup index for public.sessions(expires_at)",
    ["on public.sessions", "(expires_at)"],
  );

  assertIndex(
    sessionIndexes,
    "active-session lookup support using revoked_at",
    ["on public.sessions", "(jwt_id)", "revoked_at is null"],
  );

  assertIndex(
    auditIndexes,
    "the audit created-at lookup index",
    ["on audit.audit_logs", "(created_at desc)"],
  );

  assertIndex(
    auditIndexes,
    "the audit action lookup index",
    ["on audit.audit_logs", "(action, created_at desc)"],
  );

  assertIndex(
    auditIndexes,
    "the audit actor lookup index",
    ["on audit.audit_logs", "(actor_id, created_at desc)"],
  );

  assertIndex(
    auditIndexes,
    "the audit target lookup index",
    ["on audit.audit_logs", "(target_type, target_id, created_at desc)"],
  );
}

/**
 * Apply the forward-only compatibility extension.
 *
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
async function up(knex) {
  await addAuditActions(knex);
  await verifyAuthIndexes(knex);
}

/**
 * PostgreSQL does not safely remove individual enum values in place. Rolling
 * this migration back would require recreating the enum and every dependent
 * column, which is destructive and outside BE-01A. The migration is therefore
 * deliberately forward-only.
 *
 * @returns {Promise<never>}
 */
async function down() {
  throw new Error(
    "BE-01A auth compatibility migration is forward-only because PostgreSQL enum values cannot be safely removed in place.",
  );
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
