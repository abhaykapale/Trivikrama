import assert from "node:assert/strict";
import test from "node:test";

import { HttpAiClient } from "../../../src/modules/analysis/index.js";
import type { FeatureEnrichedEvent } from "../../../src/modules/feature-extraction/index.js";

test("sends only the 20-field model contract and maps predictions with SHAP", async () => {
    let requestedUrl = "";
    let requestBody: unknown;
    const client = new HttpAiClient(
        {
            baseUrl: "http://ai.example.test/ignored?secret=no",
            timeoutMs: 100,
            batchSize: 100,
            threshold: 0.65,
        },
        {
            fetch: async (input, init) => {
                requestedUrl = String(input);
                requestBody = JSON.parse(String(init?.body));
                return jsonResponse(successResponse(["event-1"]));
            },
        },
    );

    const result = await client.detect([event("event-1")]);
    const serialized = requestBody as {
        events: Array<{ features: Record<string, number> }>;
        threshold: number;
        include_shap: boolean;
    };

    assert.equal(requestedUrl, "http://ai.example.test/api/v1/detect/anomaly");
    assert.equal(Object.keys(serialized.events[0]!.features).length, 20);
    assert.equal("process_rarity_score" in serialized.events[0]!.features, false);
    assert.equal(serialized.threshold, 0.65);
    assert.equal(serialized.include_shap, true);
    assert.deepEqual(result.predictions[0], {
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
    });
    assert.equal(result.stats.usedFallback, false);
});

test("splits requests at the configured batch boundary", async () => {
    const batchSizes: number[] = [];
    const client = new HttpAiClient(
        { baseUrl: "http://ai.example.test", timeoutMs: 100, batchSize: 2, threshold: 0.5 },
        {
            fetch: async (_input, init) => {
                const body = JSON.parse(String(init?.body)) as {
                    events: Array<{ event_id: string }>;
                };
                batchSizes.push(body.events.length);
                return jsonResponse(successResponse(body.events.map((item) => item.event_id)));
            },
        },
    );

    const result = await client.detect([event("event-1"), event("event-2"), event("event-3")]);

    assert.deepEqual(batchSizes, [2, 1]);
    assert.equal(result.predictions.length, 3);
    assert.equal(result.stats.batchesSubmitted, 2);
});

test("uses fallback on a transport failure and opens the circuit at its threshold", async () => {
    let calls = 0;
    const client = new HttpAiClient(
        {
            baseUrl: "http://ai.example.test",
            timeoutMs: 100,
            batchSize: 100,
            threshold: 0.5,
            circuitFailureThreshold: 1,
        },
        {
            fetch: async () => {
                calls += 1;
                throw new Error("connection refused: private details");
            },
        },
    );

    const first = await client.detect([event("event-1")]);
    const second = await client.detect([event("event-2")]);

    assert.equal(first.stats.usedFallback, true);
    assert.equal(second.stats.usedFallback, true);
    assert.equal(calls, 1);
    assert.equal(client.getStats().circuitState, "open");
    assert.equal(JSON.stringify(first).includes("private details"), false);
});

test("rejects a contract-invalid success response through graceful fallback", async () => {
    const client = new HttpAiClient(
        { baseUrl: "http://ai.example.test", timeoutMs: 100, batchSize: 100, threshold: 0.5 },
        { fetch: async () => jsonResponse({ predictions: [] }) },
    );

    const result = await client.detect([event("event-1")]);

    assert.equal(result.predictions.length, 0);
    assert.equal(result.stats.usedFallback, true);
});

function event(eventId: string): FeatureEnrichedEvent {
    return {
        event_id: eventId,
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
            process_rarity_score: 0.5,
        },
    };
}

function successResponse(eventIds: readonly string[]) {
    return {
        predictions: eventIds.map((eventId) => ({
            event_id: eventId,
            anomaly_score: 0.91,
            is_anomaly: true,
            confidence: 0.98,
            shap_explanation: {
                base_value: 0.2,
                features: [{ name: "bytes_ratio", value: 10, shap_value: 0.7 }],
            },
        })),
        model_version: "v20261010_050509",
        processing_time_ms: 12.5,
        events_processed: eventIds.length,
        anomalies_detected: eventIds.length,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}
