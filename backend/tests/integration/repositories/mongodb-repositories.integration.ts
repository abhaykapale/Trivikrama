import type { IntegrationTestCase } from "./test-harness.js";
import {
  TEST_BATCH_PREFIX,
  TEST_ORG_ID,
  assertDefined,
  assertEqual,
  assertTrue,
  testDate,
} from "./test-harness.js";

export const mongoRepositoryIntegrationTests: readonly IntegrationTestCase[] = [
  {
    name: "mongodb repositories insert and query normalized events, AI results, and raw archives",
    run: async ({ mongoRepositories }) => {
      const batchId = `${TEST_BATCH_PREFIX}-mongo-001`;
      const eventId = "db09-test-event-mongo-001";

      const normalizedEvent = await mongoRepositories.normalizedEvents.create({
        event_id: eventId,
        dedup_hash: "db09-test-dedup-001",
        class_uid: 3002,
        category_uid: 3,
        severity_id: 3,
        time: testDate(300),
        message: "Failed password for root from 10.90.0.10 port 22 ssh2",
        src_endpoint: {
          ip: "10.90.0.10",
          hostname: "db09-attacker",
          port: 54321,
        },
        dst_endpoint: {
          ip: "10.90.0.20",
          hostname: "db09-test-host",
          port: 22,
        },
        actor: {
          user: {
            name: "root",
            uid: "0",
          },
        },
        device: {
          hostname: "db09-test-host",
          ip: "10.90.0.20",
          type: "server",
        },
        metadata: {
          version: "1.0.0",
          product: { name: "db09-test" },
          log_level: "warning",
        },
        enrichments: { asset_criticality: 0.8 },
        features: { failed_login_count_10min: 10 },
        schema_valid: true,
        ingestion: {
          batch_id: batchId,
          collector_id: "db09-test-collector-mongo",
          ingested_at: testDate(301),
          pipeline_duration_ms: 25,
        },
        raw_event: { message: "raw db09 event" },
        org_id: TEST_ORG_ID,
      });

      assertEqual(normalizedEvent.event_id, eventId, "Normalized event should be inserted");

      const foundEvent = await mongoRepositories.normalizedEvents.findByEventId(eventId);
      assertDefined(foundEvent, "Normalized event should be findable by event_id");
      assertEqual(foundEvent.class_uid, 3002, "Normalized event class_uid should roundtrip");

      const foundByDedup = await mongoRepositories.normalizedEvents.findByDedupHash("db09-test-dedup-001");
      assertDefined(foundByDedup, "Normalized event should be findable by dedup_hash");

      const eventPage = await mongoRepositories.normalizedEvents.list({
        orgId: TEST_ORG_ID,
        classUid: 3002,
        srcIp: "10.90.0.10",
        username: "root",
        batchId,
        limit: 10,
      });
      assertEqual(eventPage.items.length, 1, "Normalized event list should return one test event");

      const textSearch = await mongoRepositories.normalizedEvents.searchMessage("Failed password", {
        limit: 10,
      });
      assertTrue(
        textSearch.items.some((item) => item.event_id === eventId),
        "Normalized event text search should find the inserted event",
      );

      const aiResult = await mongoRepositories.aiResults.create({
        event_id: eventId,
        batch_id: batchId,
        model_name: "isolation_forest",
        model_version: "db09-test-model",
        anomaly_score: 0.91,
        is_anomaly: true,
        confidence: 0.88,
        threat_category: "brute_force",
        threat_confidence: 0.87,
        shap_explanation: {
          base_value: 0.2,
          features: [
            {
              name: "failed_login_count_10min",
              value: 10,
              shap_value: 0.33,
            },
          ],
        },
        input_features: { failed_login_count_10min: 10 },
        processing_time_ms: 35,
        used_fallback: false,
        created_at: testDate(302),
        org_id: TEST_ORG_ID,
      });

      assertEqual(aiResult.is_anomaly, true, "AI result should be inserted as an anomaly");

      const latestAi = await mongoRepositories.aiResults.findLatestByEventId(eventId);
      assertDefined(latestAi, "AI result should be findable by event_id");
      assertEqual(latestAi.model_version, "db09-test-model", "AI result should roundtrip model version");

      const anomalies = await mongoRepositories.aiResults.listAnomalies({
        orgId: TEST_ORG_ID,
        minAnomalyScore: 0.9,
        limit: 10,
      });
      assertEqual(anomalies.items.length, 1, "AI anomaly query should return one test result");

      const rawArchive = await mongoRepositories.rawEventArchive.create({
        batch_id: batchId,
        collector_id: "db09-test-collector-mongo",
        event_count: 1,
        schema_version: "1.0.0",
        events: [
          {
            message: "Failed password for root from 10.90.0.10",
            source: "db09",
          },
        ],
        file_size_bytes: 512,
        archived_at: testDate(303),
        org_id: TEST_ORG_ID,
      });
      assertEqual(rawArchive.batch_id, batchId, "Raw archive should be inserted");

      const foundArchive = await mongoRepositories.rawEventArchive.findByBatchId(batchId);
      assertDefined(foundArchive, "Raw archive should be findable by batch_id");
      assertEqual(foundArchive.event_count, 1, "Raw archive event count should roundtrip");

      const archivePage = await mongoRepositories.rawEventArchive.listByCollectorId(
        "db09-test-collector-mongo",
        { limit: 10 },
      );
      assertEqual(archivePage.items.length, 1, "Raw archive list by collector should return one record");
    },
  },
];
