import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SSH_BRUTE_FORCE_RULE_YAML } from "../../../src/database/seeds/builtin-rules.seed.js";
import {
  compileSigmaCountRuleYaml,
  EvaluateAndPersistRuleAlertsService,
  ReloadableOrganizationSigmaRuleEngine,
  type RecordCountWindowMatchInput,
  type RuleAlert,
} from "../../../src/modules/detection/index.js";
import {
  createCollectorMessageVerifier,
  InMemoryCollectorTrustStore,
  OcsfCollectorEventNormalizer,
  type CollectorEventBatch,
  type JsonValue,
} from "../../../src/modules/ingestion/index.js";
import { Rfc8785Canonicalizer } from "../../../src/modules/ingestion/infrastructure/json/rfc8785-canonicalizer.js";

const ORG_ID = "sys-01a-offline-rule-test";
const NOW = new Date("2026-10-29T06:00:00.000Z");

test("verified Collector failures trigger the shipped count rule only at ten per source IP", async () => {
  const compiled = compileSigmaCountRuleYaml(SSH_BRUTE_FORCE_RULE_YAML);
  assert.equal(compiled.count.threshold, 10);
  assert.equal(compiled.count.timeWindowSeconds, 300);
  assert.equal(compiled.count.field, "src_endpoint.ip");
  assert.equal(compiled.cooldownSeconds, 300);
  const windows = new Map<string, Map<string, number>>();
  const leases = new Map<string, string>();
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: ORG_ID,
    source: { async listActiveMatchRules() { return []; } },
    countSource: {
      async listActiveCountRules() {
        return [{ databaseId: "00000000-0000-4000-8000-000000000101",
          organizationId: ORG_ID, name: compiled.title, severity: compiled.severity,
          weight: compiled.weight, classUid: 3002, categoryUid: 3,
          yamlContent: SSH_BRUTE_FORCE_RULE_YAML }];
      },
    },
    countWindowStore: {
      async recordMatch(input: RecordCountWindowMatchInput) {
        assert.equal(input.organizationId, ORG_ID);
        const key = [input.organizationId, input.ruleId, input.ruleStateVersion, input.entityKey].join("|");
        const entries = windows.get(key) ?? new Map<string, number>();
        for (const [id, time] of entries) {
          if (time <= input.occurredAtEpochMs - input.windowSeconds * 1000) entries.delete(id);
        }
        const inserted = !entries.has(input.eventId);
        if (inserted) entries.set(input.eventId, input.occurredAtEpochMs);
        windows.set(key, entries);
        return { inserted, count: entries.size, eventIds: [...entries.keys()] };
      },
    },
    cooldownStore: {
      async tryAcquire(input) {
        const owner = leases.get(input.entityKey);
        if (owner !== undefined) return owner === input.alertId;
        leases.set(input.entityKey, input.alertId);
        return true;
      },
    },
    now: () => NOW,
  });
  await engine.reloadRules();
  const alerts: RuleAlert[] = [];
  const service = new EvaluateAndPersistRuleAlertsService({
    organizationId: ORG_ID,
    ruleEngine: engine,
    alertPersistence: {
      async execute(orgId, generated) {
        assert.equal(orgId, ORG_ID);
        alerts.push(...generated);
        return { insertedCount: generated.length, alreadyPresentCount: 0, records: [] };
      },
    },
  });
  const normalizer = new OcsfCollectorEventNormalizer(ORG_ID);
  const failures = normalizer.normalize(await verifiedBatch(0, 10, false), NOW).events;
  const successes = normalizer.normalize(await verifiedBatch(20, 12, true), NOW).events;
  const otherSource = normalizer.normalize(await verifiedBatch(40, 9, false, "203.0.113.251"), NOW).events;

  assert.equal((await service.execute(successes)).insertedAlerts, 0);
  assert.equal(windows.size, 0, "successes must not enter the count window");
  assert.equal((await service.execute(failures.slice(0, 9))).insertedAlerts, 0);
  assert.equal((await service.execute(otherSource)).insertedAlerts, 0);
  assert.equal((await service.execute([failures[9]])).insertedAlerts, 1);
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].matchedEvents, failures.map((event) => event.event_id));
  assert.equal(alerts[0].metadata.groupByValue, "203.0.113.250");
  assert.equal(alerts[0].metadata.threshold, 10);
  const above = normalizer.normalize(await verifiedBatch(60, 1, false), NOW).events;
  assert.equal((await service.execute(above)).insertedAlerts, 0);
  assert.equal(alerts.length, 1);

  // Defense in depth beyond the Collector's semantic validator.
  const failure = { ...failures[0] };
  assert.equal(compiled.matches({ ...failure, status_id: 1 }), false);
  assert.equal(compiled.matches({ ...failure, message: "Unrelated authentication event" }), false);
});

/** Only in-memory, signed test fixtures: nothing is written to Collector intake. */
async function verifiedBatch(offset: number, count: number, success: boolean, ip = "203.0.113.250") {
  const fixture = JSON.parse(readFileSync(
    "../contracts/collector-ingress/v1/fixtures/positive/event-batch.json", "utf8",
  )) as CollectorEventBatch;
  const template = fixture.events[0];
  const events = Array.from({ length: count }, (_, index) => {
    const start = (offset + index) * 500;
    const identity = `${template.source.source_id}\n${template.source.position.file_identity}\n${start}`;
    const payload = JSON.parse(template.raw_payload);
    payload.event_type = success ? "login_success" : "login_failed";
    payload.username = "administrator";
    payload.source_ip = ip;
    return { ...template,
      event_id: `sha256:${createHash("sha256").update(identity).digest("hex")}`,
      source: { ...template.source, position: { ...template.source.position,
        record_start_offset: start, record_end_offset: start + 499 } },
      raw_payload: JSON.stringify(payload),
      ocsf: { ...template.ocsf,
        status_id: success ? 1 as const : 2 as const,
        severity_id: success ? 1 as const : 3 as const,
        message: `${success ? "Successful" : "Failed"} login for administrator`,
        src_endpoint: { ip }, user: { name: "administrator" } },
    };
  });
  const key = randomBytes(32);
  const { integrity, ...unsigned } = { ...fixture, events, event_count: events.length };
  const canonical = new Rfc8785Canonicalizer().canonicalize({ ...unsigned,
    integrity: { algorithm: integrity.algorithm, key_id: integrity.key_id },
  } as unknown as JsonValue);
  const value = createHmac("sha256", key).update("TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n")
    .update(canonical).digest("base64url");
  const verifier = createCollectorMessageVerifier({ trustStore: new InMemoryCollectorTrustStore([
    { collectorId: fixture.collector_id, keyId: integrity.key_id, key },
  ]) });
  const verified = await verifier.verify(Buffer.from(JSON.stringify({ ...unsigned, integrity: { ...integrity, value } })));
  assert.equal(verified.message.message_type, "event_batch");
  if (verified.message.message_type !== "event_batch") throw new Error("Expected batch");
  return verified.message;
}
