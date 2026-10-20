import assert from "node:assert/strict";
import test from "node:test";

import type { CreateAiResultInput } from "../../../src/database/repositories/mongodb/ai-result.repository.js";
import {
    DetectAndPersistAiResultsService,
    type AiDetectionResult,
} from "../../../src/modules/analysis/index.js";
import type { FeatureEnrichedEvent } from "../../../src/modules/feature-extraction/index.js";

test("persists AI scores, exact inputs, and SHAP data idempotently", async () => {
    const repository = new RecordingRepository();
    const service = new DetectAndPersistAiResultsService({
        organizationId: "organization-blue",
        client: { detect: async () => detectionResult(false) },
        results: repository,
        now: () => new Date("2026-10-10T05:00:00.000Z"),
    });

    const result = await service.execute([event()]);

    assert.deepEqual(result, {
        eventsSubmitted: 1,
        eventsScored: 1,
        anomaliesDetected: 1,
        insertedResults: 1,
        alreadyPresentResults: 0,
        usedFallback: false,
        results: repository.inputs,
    });
    assert.equal(Object.keys(repository.inputs[0]!.input_features!).length, 20);
    assert.equal(repository.inputs[0]!.model_name, "isolation_forest_v1");
    assert.equal(repository.inputs[0]!.shap_explanation?.features?.[0]?.name, "bytes_ratio");
});

test("persists nothing when the AI client activates rule-only fallback", async () => {
    const repository = new RecordingRepository();
    const service = new DetectAndPersistAiResultsService({
        organizationId: "organization-blue",
        client: { detect: async () => detectionResult(true) },
        results: repository,
        now: () => new Date(),
    });

    const result = await service.execute([event()]);

    assert.equal(result.usedFallback, true);
    assert.equal(result.eventsScored, 0);
    assert.deepEqual(repository.inputs, []);
});

class RecordingRepository {
    public inputs: readonly CreateAiResultInput[] = [];

    public async createManyIfAbsent(inputs: readonly CreateAiResultInput[]) {
        this.inputs = inputs;
        return { insertedCount: inputs.length, existingCount: 0 };
    }
}

function detectionResult(fallback: boolean): AiDetectionResult {
    return {
        predictions: fallback
            ? []
            : [
                  {
                      eventId: "event-1",
                      anomalyScore: 0.91,
                      isAnomaly: true,
                      confidence: 0.98,
                      shapExplanation: {
                          baseValue: 0.2,
                          features: [{ name: "bytes_ratio", value: 10, shapValue: 0.7 }],
                      },
                      modelVersion: "v20261010_050509",
                      processingTimeMs: 12.5,
                  },
              ],
        stats: {
            eventsSubmitted: 1,
            eventsScored: fallback ? 0 : 1,
            anomaliesDetected: fallback ? 0 : 1,
            batchesSubmitted: fallback ? 0 : 1,
            requestDurationMs: 10,
            usedFallback: fallback,
        },
    };
}

function event(): FeatureEnrichedEvent {
    return {
        event_id: "event-1",
        class_uid: 3002,
        category_uid: 3,
        severity_id: 3,
        time: new Date("2026-10-10T00:00:00.000Z"),
        message: "failed login",
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "batch-1",
            collector_id: "collector-1",
            ingested_at: new Date("2026-10-10T00:00:01.000Z"),
        },
        org_id: "organization-blue",
        features: {
            hour_of_day: 0,
            day_of_week: 0,
            is_business_hours: 0,
            time_since_last_event: 0,
            time_deviation_score: 0,
            events_per_minute_src_ip: 0,
            events_per_hour_user: 0,
            unique_dst_ips_per_src: 0,
            unique_users_per_src_ip: 0,
            frequency_deviation: 0,
            src_ip_entropy: 0,
            username_entropy: 0,
            process_name_entropy: 0,
            bytes_sent: 100,
            bytes_received: 10,
            bytes_ratio: 10,
            severity_id: 3,
            failed_login_count_10min: 1,
            failed_to_success_ratio: 1,
            new_source_ip: 1,
        },
    };
}
