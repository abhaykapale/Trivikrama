import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    AI_FEATURE_NAMES,
    DeterministicFeatureExtractor,
    shannonCharacterEntropy,
} from "../../../src/modules/feature-extraction/index.js";

test("extracts the exact deterministic 20-feature AI contract", async () => {
    const input = normalizedEvent({
        time: new Date("2026-09-14T10:30:00.000Z"), // Monday
        severity_id: 4,
        src_endpoint: { ip: "ab" },
        actor: {
            user: { name: "aa" },
            process: { name: "abcd" },
        },
    });
    const extractor = new DeterministicFeatureExtractor({
        timeSinceLastEventDefaultSeconds: 12.5,
    });

    const result = await extractor.extract([input]);
    const enriched = result.events[0];

    assert.ok(enriched);
    assert.equal(result.totalEvents, 1);
    assert.equal(enriched.event_id, input.event_id);
    assert.equal(enriched.org_id, input.org_id);
    assert.deepEqual(Object.keys(enriched.features), AI_FEATURE_NAMES);
    assert.deepEqual(enriched.features, {
        hour_of_day: 10,
        day_of_week: 0,
        is_business_hours: 1,
        time_since_last_event: 12.5,
        time_deviation_score: 0,
        events_per_minute_src_ip: 0,
        events_per_hour_user: 0,
        unique_dst_ips_per_src: 1,
        unique_users_per_src_ip: 1,
        frequency_deviation: 0,
        src_ip_entropy: 1,
        username_entropy: 0,
        process_name_entropy: 2,
        bytes_sent: 0,
        bytes_received: 0,
        bytes_ratio: 1,
        severity_id: 4,
        failed_login_count_10min: 0,
        failed_to_success_ratio: 0,
        new_source_ip: 0,
    });
    assert.ok(Object.values(enriched.features).every(Number.isFinite));
});

test("uses neutral defaults when optional event fields are absent", async () => {
    const event = normalizedEvent({ time: new Date("2026-09-20T11:00:00.000Z") });

    const first = await new DeterministicFeatureExtractor().extract([event]);
    const second = await new DeterministicFeatureExtractor().extract([event]);

    assert.deepEqual(first, second);
    assert.equal(first.events[0]?.features.day_of_week, 6);
    assert.equal(first.events[0]?.features.is_business_hours, 0);
    assert.equal(first.events[0]?.features.src_ip_entropy, 0);
    assert.equal(first.events[0]?.features.username_entropy, 0);
    assert.equal(first.events[0]?.features.process_name_entropy, 0);
});

test("calculates Shannon character entropy", () => {
    assert.equal(shannonCharacterEntropy(undefined), 0);
    assert.equal(shannonCharacterEntropy("aaaa"), 0);
    assert.equal(shannonCharacterEntropy("ab"), 1);
    assert.equal(shannonCharacterEntropy("abcd"), 2);
});

test("rejects events that lost their organization boundary", async () => {
    const event = normalizedEvent({ org_id: " " });

    await assert.rejects(
        new DeterministicFeatureExtractor().extract([event]),
        /trusted organization boundary/,
    );
});

test("rejects invalid configuration before processing events", () => {
    assert.throws(
        () =>
            new DeterministicFeatureExtractor({
                timeSinceLastEventDefaultSeconds: Number.NaN,
            }),
        /finite non-negative/,
    );
    assert.throws(
        () =>
            new DeterministicFeatureExtractor({
                businessHourStartUtc: 17,
                businessHourEndUtc: 9,
            }),
        /earlier/,
    );
});

function normalizedEvent(
    overrides: Partial<CreateNormalizedEventInput> = {},
): CreateNormalizedEventInput {
    return {
        event_id: "event-be-feat-01a-001",
        class_uid: 1001,
        category_uid: 1,
        severity_id: 3,
        time: new Date("2026-09-14T10:30:00.000Z"),
        message: "Successful authentication",
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "batch-be-feat-01a-001",
            collector_id: "collector-dev-01",
            ingested_at: new Date("2026-09-14T10:30:01.000Z"),
        },
        org_id: "org-001",
        ...overrides,
    };
}
