/** SYS-01A: repair only the unchanged, known built-in Collector count rule.
 * Content is snapshotted here so future seed edits cannot change migration history.
 */
const { createHash } = require("node:crypto");
const RULE_ID = "00000000-0000-4000-8000-000000000101";
const MIGRATION = "20261029000100_sys_01a_collector_builtin_rule";

const LEGACY_YAML = `title: SSH Brute Force
id: rule-bf-ssh-001
description: >
  Detects multiple failed SSH login attempts from the same
  source IP within a short time window.
status: active
level: high
weight: 0.8
priority: 800
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: "Failed password"
    severity_id|gte: 3
  condition: "selection"
  count:
    field: "src_endpoint.ip"
    threshold: 10
    timewindow: "5m"
alert:
  cooldown: "5m"
tags:
  - attack.credential_access
  - attack.t1110
falsepositives:
  - Automated testing
  - Legitimate password reset
references:
  - https://attack.mitre.org/techniques/T1110/
`;

const CORRECTED_YAML = `title: SSH Brute Force
id: rule-bf-ssh-001
description: >
  Detects multiple failed SSH login attempts from the same
  source IP within a short time window.
status: active
level: high
weight: 0.8
priority: 800
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    status_id: 2
    message|startswith: "Failed login for "
    severity_id|gte: 3
  condition: "selection"
  count:
    field: "src_endpoint.ip"
    threshold: 10
    timewindow: "5m"
alert:
  cooldown: "5m"
tags:
  - attack.credential_access
  - attack.t1110
falsepositives:
  - Automated testing
  - Legitimate password reset
references:
  - https://attack.mitre.org/techniques/T1110/
`;

async function up(knex) {
  const legacyHash = hash(LEGACY_YAML);
  const rule = await knex("public.rules")
    .where({ id: RULE_ID, name: "SSH Brute Force", is_builtin: true })
    .forUpdate()
    .first();

  // Preserve operator-authored/customized content, including a changed hash or
  // revision. A name match alone never authorizes an update, in any tenant.
  if (!rule || rule.version !== 1 || rule.yaml_content !== LEGACY_YAML ||
      rule.compiled_hash !== legacyHash || rule.type !== "count" ||
      rule.class_uid !== 3002 || rule.category_uid !== 3) return;

  const changes = {
    yaml_content: CORRECTED_YAML,
    compiled_hash: hash(CORRECTED_YAML),
    version: rule.version + 1,
    updated_by: null,
  };
  const updated = await knex("public.rules")
    .where({ id: rule.id, org_id: rule.org_id, is_builtin: true,
      version: rule.version, compiled_hash: legacyHash })
    .update(changes);
  if (updated !== 1) throw new Error("Built-in rule changed during upgrade");

  await knex("audit.audit_logs").insert({
    action: "rule_update",
    actor_id: null,
    actor_username: "system_migration",
    actor_role: null,
    target_type: "rule",
    target_id: rule.id,
    target_name: rule.name,
    org_id: rule.org_id,
    details: {
      source: "database_migration",
      migration: MIGRATION,
      sigma_rule_id: "rule-bf-ssh-001",
      reason: "Align built-in count detection with verified Collector failed-authentication OCSF fields",
    },
    previous_state: { version: rule.version, compiled_hash: rule.compiled_hash,
      yaml_content: rule.yaml_content, org_id: rule.org_id },
    new_state: { version: changes.version, compiled_hash: changes.compiled_hash,
      yaml_content: changes.yaml_content, org_id: rule.org_id },
  });
}

// Forward-only data correction: never restore broken detection or erase audit history.
async function down() {}
function hash(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
const config = { transaction: true };
module.exports = { up, down, config };
