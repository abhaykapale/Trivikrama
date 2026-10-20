import env from "../config/env.js";
import { HttpAiClient } from "../modules/analysis/index.js";
import type { AiFeatureVector, FeatureEnrichedEvent } from "../modules/feature-extraction/index.js";

async function main(): Promise<void> {
    const client = new HttpAiClient({
        baseUrl: env.ai.engineUrl,
        timeoutMs: env.ai.timeoutMs,
        batchSize: env.ai.batchSize,
        threshold: env.ai.threshold,
        circuitFailureThreshold: env.ai.circuitFailureThreshold,
        circuitCooldownMs: env.ai.circuitCooldownMs,
        circuitSuccessThreshold: env.ai.circuitSuccessThreshold,
    });
    const result = await client.detect([
        event("backend-proof-normal", NORMAL_FEATURES),
        event("backend-proof-anomalous", ANOMALOUS_FEATURES),
    ]);
    const normal = result.predictions.find((item) => item.eventId === "backend-proof-normal");
    const anomalous = result.predictions.find(
        (item) => item.eventId === "backend-proof-anomalous",
    );
    const passed =
        result.stats.usedFallback === false &&
        normal?.isAnomaly === false &&
        anomalous?.isAnomaly === true &&
        anomalous.shapExplanation !== null;

    console.log(
        JSON.stringify(
            {
                proof: "backend-to-ai-http-contract",
                passed,
                aiEngineUrl: env.ai.engineUrl,
                stats: result.stats,
                predictions: result.predictions,
                client: client.getStats(),
            },
            null,
            2,
        ),
    );

    if (!passed) process.exitCode = 1;
}

function event(eventId: string, features: AiFeatureVector): FeatureEnrichedEvent {
    return {
        event_id: eventId,
        class_uid: 3002,
        category_uid: 3,
        severity_id: features.severity_id,
        time: new Date(),
        message: "Backend-to-AI contract proof event",
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "backend-ai-proof",
            collector_id: "backend-proof",
            ingested_at: new Date(),
        },
        org_id: env.collector.organizationId ?? "default",
        features,
    };
}

const NORMAL_FEATURES: AiFeatureVector = Object.freeze({
    hour_of_day: 11,
    day_of_week: 2,
    is_business_hours: 1,
    time_since_last_event: 45,
    time_deviation_score: 0.1,
    events_per_minute_src_ip: 2,
    events_per_hour_user: 18,
    unique_dst_ips_per_src: 3,
    unique_users_per_src_ip: 1,
    frequency_deviation: 0.2,
    src_ip_entropy: 2,
    username_entropy: 1.5,
    process_name_entropy: 2.2,
    bytes_sent: 1_500,
    bytes_received: 6_000,
    bytes_ratio: 0.25,
    severity_id: 1,
    failed_login_count_10min: 0,
    failed_to_success_ratio: 0,
    new_source_ip: 0,
});

const ANOMALOUS_FEATURES: AiFeatureVector = Object.freeze({
    hour_of_day: 3,
    day_of_week: 6,
    is_business_hours: 0,
    time_since_last_event: 86_400,
    time_deviation_score: 15,
    events_per_minute_src_ip: 500,
    events_per_hour_user: 2_000,
    unique_dst_ips_per_src: 500,
    unique_users_per_src_ip: 100,
    frequency_deviation: 20,
    src_ip_entropy: 8,
    username_entropy: 8,
    process_name_entropy: 8,
    bytes_sent: 100_000_000,
    bytes_received: 100,
    bytes_ratio: 1_000_000,
    severity_id: 6,
    failed_login_count_10min: 250,
    failed_to_success_ratio: 1,
    new_source_ip: 1,
});

void main().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            proof: "backend-to-ai-http-contract",
            passed: false,
            error: error instanceof Error ? error.name : "UnknownError",
        }),
    );
    process.exitCode = 1;
});
