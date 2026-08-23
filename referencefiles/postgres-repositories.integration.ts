import crypto from "node:crypto";

import type { IntegrationTestCase } from "./test-harness.js";
import {
  TEST_KEY_PREFIX,
  TEST_ORG_ID,
  TEST_QUEUE_PREFIX,
  assertDefined,
  assertEqual,
  assertFalse,
  assertTrue,
  testDate,
  testUuid,
} from "./test-harness.js";

export const postgresRepositoryIntegrationTests: readonly IntegrationTestCase[] = [
  {
    name: "postgres repositories create, read, update, and list core operational rows",
    run: async ({ repositories }) => {
      const user = await repositories.users.create({
        id: testUuid("001"),
        username: "db09_admin",
        email: "db09-admin@example.local",
        passwordHash: "$2b$12$db09integrationtesthashplaceholder0000000000000000000000",
        role: "admin",
        displayName: "DB09 Admin",
        orgId: TEST_ORG_ID,
      });

      assertEqual(user.username, "db09_admin", "User create should return the inserted username");

      const foundByUsername = await repositories.users.findByUsername("db09_admin", TEST_ORG_ID);
      assertDefined(foundByUsername, "User should be findable by username");
      assertEqual(foundByUsername.id, user.id, "User lookup should return the created user");

      const updatedUser = await repositories.users.update(user.id, {
        failedLoginCount: 2,
        lockedUntil: testDate(600),
      });
      assertDefined(updatedUser, "User update should return a record");
      assertEqual(updatedUser.failedLoginCount, 2, "User failed-login count should update");

      const config = await repositories.configuration.createIfMissing({
        key: `${TEST_KEY_PREFIX}sample`,
        value: { enabled: true, limit: 3 },
        description: "DB09 repository integration test config",
        isSensitive: false,
        updatedBy: user.id,
      });
      assertEqual(config.key, `${TEST_KEY_PREFIX}sample`, "Configuration key should be inserted");

      const updatedConfig = await repositories.configuration.updateValue(`${TEST_KEY_PREFIX}sample`, {
        value: { enabled: false, limit: 5 },
        updatedBy: user.id,
      });
      assertDefined(updatedConfig, "Configuration update should return a record");
      assertEqual(
        (updatedConfig.value as { enabled: boolean }).enabled,
        false,
        "Configuration value should update",
      );

      const ruleYaml = [
        "title: DB09 Test Rule",
        "id: db09-test-rule",
        "status: test",
        "level: low",
      ].join("\n");

      const rule = await repositories.rules.create({
        id: testUuid("002"),
        name: "DB09 Test Rule",
        description: "Repository integration test rule",
        type: "match",
        severity: "low",
        weight: 0.2,
        yamlContent: ruleYaml,
        compiledHash: crypto.createHash("sha256").update(ruleYaml).digest("hex"),
        classUid: 3002,
        categoryUid: 3,
        tags: ["db09", "integration"],
        falsePositives: ["test only"],
        ruleReferences: [],
        isBuiltin: false,
        createdBy: user.id,
        orgId: TEST_ORG_ID,
      });
      assertEqual(rule.name, "DB09 Test Rule", "Rule create should return the inserted rule");

      const disabledRule = await repositories.rules.disable(rule.id, user.id);
      assertDefined(disabledRule, "Rule disable should return a record");
      assertEqual(disabledRule.status, "disabled", "Rule status should be disabled");

      const session = await repositories.sessions.create({
        id: testUuid("003"),
        userId: user.id,
        jwtId: "db09-test-jwt",
        ipAddress: "127.0.0.1",
        userAgent: "db09-integration-test",
        expiresAt: testDate(3_600),
      });
      assertEqual(session.jwtId, "db09-test-jwt", "Session create should return the JWT id");

      const revokedSession = await repositories.sessions.revokeByJwtId("db09-test-jwt", testDate(10));
      assertDefined(revokedSession, "Session revoke should return a record");
      assertDefined(revokedSession.revokedAt, "Session should have revokedAt after revoke");

      const asset = await repositories.assets.create({
        id: testUuid("004"),
        name: "DB09 Test Asset",
        assetType: "server",
        ipAddress: "10.90.0.10",
        hostname: "db09-test-host",
        criticality: 0.7,
        owner: "Security",
        department: "SOC",
        tags: ["db09"],
        metadata: { environment: "integration" },
        orgId: TEST_ORG_ID,
      });
      assertEqual(asset.hostname, "db09-test-host", "Asset create should return hostname");

      const foundAsset = await repositories.assets.findByHostname("db09-test-host", TEST_ORG_ID);
      assertDefined(foundAsset, "Asset should be findable by hostname");
      assertEqual(foundAsset.id, asset.id, "Asset lookup should return created asset");

      const collector = await repositories.collectorStatus.upsertHeartbeat({
        id: testUuid("005"),
        collectorId: "db09-test-collector-01",
        status: "online",
        lastHeartbeatAt: testDate(20),
        heartbeatData: { version: "test" },
        filesProcessed: 2,
        eventsCollected: 10,
        eventsDropped: 0,
        errorsCount: 0,
        cpuPercent: 12.5,
        memoryMb: 128,
        orgId: TEST_ORG_ID,
      });
      assertEqual(collector.status, "online", "Collector heartbeat should insert online status");

      const offlineCollector = await repositories.collectorStatus.markOffline("db09-test-collector-01");
      assertDefined(offlineCollector, "Collector markOffline should return a record");
      assertEqual(offlineCollector.status, "offline", "Collector should be marked offline");

      const queueMetric = await repositories.queueMetrics.createSnapshot({
        id: testUuid("006"),
        queueName: `${TEST_QUEUE_PREFIX}pipeline`,
        waiting: 1,
        active: 2,
        completed: 3,
        failed: 0,
        deadLettered: 0,
        isPaused: false,
        snapshotAt: testDate(30),
      });
      assertEqual(queueMetric.completed, 3, "Queue metric should store completed count");

      const latestMetric = await repositories.queueMetrics.findLatest(`${TEST_QUEUE_PREFIX}pipeline`);
      assertDefined(latestMetric, "Latest queue metric should be findable");
      assertEqual(latestMetric.id, queueMetric.id, "Latest queue metric should match inserted snapshot");

      const audit = await repositories.audit.create({
        id: crypto.randomUUID(),
        action: "user_create",
        actorId: null,
        actorUsername: user.username,
        actorRole: user.role,
        targetType: "user",
        targetId: user.id,
        targetName: user.username,
        details: { source: "db09" },
        orgId: TEST_ORG_ID,
      });
      assertEqual(audit.action, "user_create", "Audit repository should append an audit row");

      const visibleConfigPage = await repositories.configuration.list({
        keyPrefix: TEST_KEY_PREFIX,
        limit: 10,
      });
      assertTrue(visibleConfigPage.items.length >= 1, "Configuration list should include test config");

      const rulePage = await repositories.rules.list({ orgId: TEST_ORG_ID, limit: 10 });
      assertEqual(rulePage.items.length, 1, "Rule list should include exactly the test rule");

      const deactivatedAsset = await repositories.assets.deactivate(asset.id);
      assertDefined(deactivatedAsset, "Asset deactivate should return a record");
      assertFalse(deactivatedAsset.isActive, "Asset should be inactive after deactivate");
    },
  },
  {
    name: "incident repositories create grouped incident artifacts and lifecycle updates",
    run: async ({ repositories }) => {
      const analyst = await repositories.users.create({
        id: testUuid("011"),
        username: "db09_analyst",
        email: "db09-analyst@example.local",
        passwordHash: "$2b$12$db09integrationtesthashplaceholder0000000000000000000001",
        role: "soc_analyst",
        displayName: "DB09 Analyst",
        orgId: TEST_ORG_ID,
      });

      const incident = await repositories.incidents.create({
        id: testUuid("012"),
        title: "DB09 SSH Brute Force",
        description: "Repository integration incident",
        status: "open",
        severity: "high",
        riskScore: 75.5,
        source: "rule",
        scoreBreakdown: { rule: 0.8 },
        primaryEntity: "10.90.0.10",
        entityType: "src_ip",
        entities: [{ type: "src_ip", value: "10.90.0.10" }],
        killChainStages: ["credential_access"],
        alertCount: 1,
        eventCount: 2,
        firstEventAt: testDate(100),
        lastEventAt: testDate(120),
        orgId: TEST_ORG_ID,
      });
      assertEqual(incident.status, "open", "Incident should be created as open");

      const assigned = await repositories.incidents.assign(incident.id, analyst.id);
      assertDefined(assigned, "Incident assign should return a record");
      assertEqual(assigned.assignedTo, analyst.id, "Incident should be assigned to analyst");

      const alert = await repositories.alerts.create({
        id: testUuid("013"),
        incidentId: incident.id,
        alertType: "rule",
        ruleName: "DB09 Test Rule",
        matchedCondition: "count(src_endpoint.ip) >= 10",
        severity: "high",
        weight: 0.8,
        tags: ["attack.t1110"],
        metadata: { source: "db09" },
        matchedEventIds: ["db09-test-event-001", "db09-test-event-002"],
        orgId: TEST_ORG_ID,
      });
      assertEqual(alert.incidentId, incident.id, "Alert should be linked to incident");

      const note = await repositories.incidentNotes.create({
        id: testUuid("014"),
        incidentId: incident.id,
        authorId: analyst.id,
        content: "DB09 investigation note",
      });
      assertEqual(note.content, "DB09 investigation note", "Incident note should be created");

      const eventLink = await repositories.incidentEvents.create({
        id: testUuid("015"),
        incidentId: incident.id,
        eventId: "db09-test-event-001",
        eventTime: testDate(100),
        classUid: 3002,
        severityId: 3,
        srcIp: "10.90.0.10",
        username: "root",
        hostname: "db09-test-host",
      });
      assertEqual(eventLink.eventId, "db09-test-event-001", "Incident event link should be created");

      const incidentAlerts = await repositories.alerts.listByIncident(incident.id, { limit: 10 });
      assertEqual(incidentAlerts.items.length, 1, "Incident should list one alert");

      const incidentNotes = await repositories.incidentNotes.listByIncident(incident.id, { limit: 10 });
      assertEqual(incidentNotes.items.length, 1, "Incident should list one note");

      const incidentEvents = await repositories.incidentEvents.listByIncident(incident.id, { limit: 10 });
      assertEqual(incidentEvents.items.length, 1, "Incident should list one event link");

      const transitioned = await repositories.incidents.transitionStatus(incident.id, {
        status: "resolved",
        resolvedAt: testDate(200),
      });
      assertDefined(transitioned, "Incident status transition should return a record");
      assertEqual(transitioned.status, "resolved", "Incident should transition to resolved");
      assertDefined(transitioned.resolvedAt, "Resolved incident should have resolvedAt");
    },
  },
];
