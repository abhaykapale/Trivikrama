import { createHash } from "node:crypto";

import type { Knex } from "knex";

import type {
  AdminActorRow,
  ExistingRuleRow,
  RuleLookupRow,
  SeedContext,
  SeedStepResult,
  UserTableRow,
} from "./seed.types.js";



const BUILTIN_RULES_STEP_NAME = "builtin-rules";
const SSH_BRUTE_FORCE_RULE_DB_ID = "00000000-0000-4000-8000-000000000101";
const SSH_BRUTE_FORCE_RULE_SIGMA_ID = "rule-bf-ssh-001";
const SSH_BRUTE_FORCE_RULE_NAME = "SSH Brute Force";
const SSH_BRUTE_FORCE_RULE_DESCRIPTION =
  "Detects multiple failed SSH login attempts from the same source IP within a short time window.";

const SSH_BRUTE_FORCE_RULE_TAGS = [
  "attack.credential_access",
  "attack.t1110",
] as const;

const SSH_BRUTE_FORCE_RULE_FALSE_POSITIVES = [
  "Automated testing",
  "Legitimate password reset",
] as const;

const SSH_BRUTE_FORCE_RULE_REFERENCES = [
  "https://attack.mitre.org/techniques/T1110/",
] as const;

const SSH_BRUTE_FORCE_RULE_YAML = `title: SSH Brute Force
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


export async function seedBuiltinRules(
  context: SeedContext,
): Promise<SeedStepResult> {
  const existingRule = await findExistingSshBruteForceRule(
    context.trx,
    context.initialAdmin.orgId,
  );

  if (existingRule) {
    if (!existingRule.is_builtin) {
      throw new Error(
        `Cannot seed built-in rule "${SSH_BRUTE_FORCE_RULE_NAME}" because a non-built-in rule with the same identity already exists in org "${context.initialAdmin.orgId}". Resolve the collision manually to avoid overwriting operator-authored detection content.`,
      );
    }

    return {
      name: BUILTIN_RULES_STEP_NAME,
      status: "skipped",
      inserted: 0,
      updated: 0,
      skipped: 1,
      message: `Built-in rule "${existingRule.name}" already exists in org "${existingRule.org_id}". Existing built-in rules are never overwritten by the seed runner.`,
    };
  }

  const createdBy = await findSeedAdminActor(context.trx, context.initialAdmin.orgId);
  const compiledHash = sha256(SSH_BRUTE_FORCE_RULE_YAML);

  await context.trx("public.rules").insert({
    id: SSH_BRUTE_FORCE_RULE_DB_ID,
    name: SSH_BRUTE_FORCE_RULE_NAME,
    description: SSH_BRUTE_FORCE_RULE_DESCRIPTION,
    status: "active",
    type: "count",
    severity: "high",
    weight: 0.8,
    yaml_content: SSH_BRUTE_FORCE_RULE_YAML,
    compiled_hash: compiledHash,
    class_uid: 3002,
    category_uid: 3,
    tags: JSON.stringify([...SSH_BRUTE_FORCE_RULE_TAGS]),
    false_positives: JSON.stringify([...SSH_BRUTE_FORCE_RULE_FALSE_POSITIVES]),
    rule_references: JSON.stringify([...SSH_BRUTE_FORCE_RULE_REFERENCES]),
    version: 1,
    is_builtin: true,
    created_by: createdBy?.id ?? null,
    updated_by: null,
    org_id: context.initialAdmin.orgId,
  });

  await writeBuiltinRuleSeedAuditLog(context, createdBy, compiledHash);

  return {
    name: BUILTIN_RULES_STEP_NAME,
    status: "success",
    inserted: 1,
    updated: 0,
    skipped: 0,
    message:
      "Built-in SSH brute-force detection rule inserted. Existing built-in rules are preserved on rerun.",
  };
}

async function findExistingSshBruteForceRule(
  trx: Knex.Transaction,
  orgId: string,
): Promise<ExistingRuleRow | undefined> {
  return trx<ExistingRuleRow>("public.rules")
    .select("id", "name", "is_builtin", "org_id")
    .where("org_id", orgId)
    .andWhere((builder) => {
      builder.where("id", SSH_BRUTE_FORCE_RULE_DB_ID).orWhere("name", SSH_BRUTE_FORCE_RULE_NAME);
    })
    .first();
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

async function writeBuiltinRuleSeedAuditLog(
  context: SeedContext,
  createdBy: AdminActorRow | undefined,
  compiledHash: string,
): Promise<void> {
  await context.trx("audit.audit_logs").insert({
    action: "rule_create",
    actor_id: createdBy?.id ?? null,
    actor_username: createdBy?.username ?? "system_seed",
    actor_role: createdBy?.role ?? null,
    target_type: "rule",
    target_id: SSH_BRUTE_FORCE_RULE_DB_ID,
    target_name: SSH_BRUTE_FORCE_RULE_NAME,
    details: {
      source: "database_seed",
      seed_step: BUILTIN_RULES_STEP_NAME,
      sigma_rule_id: SSH_BRUTE_FORCE_RULE_SIGMA_ID,
      compiled_hash: compiledHash,
      overwrite_existing_rule: false,
    },
    new_state: {
      id: SSH_BRUTE_FORCE_RULE_DB_ID,
      name: SSH_BRUTE_FORCE_RULE_NAME,
      status: "active",
      type: "count",
      severity: "high",
      weight: 0.8,
      class_uid: 3002,
      category_uid: 3,
      tags: [...SSH_BRUTE_FORCE_RULE_TAGS],
      false_positives: [...SSH_BRUTE_FORCE_RULE_FALSE_POSITIVES],
      references: [...SSH_BRUTE_FORCE_RULE_REFERENCES],
      version: 1,
      is_builtin: true,
      org_id: context.initialAdmin.orgId,
    },
    org_id: context.initialAdmin.orgId,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
