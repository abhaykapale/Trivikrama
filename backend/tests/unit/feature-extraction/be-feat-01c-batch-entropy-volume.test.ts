import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    AI_FEATURE_NAMES,
    BatchEntropyVolumeFeatureExtractor,
    DeterministicFeatureExtractor,
    shannonDistributionEntropy,
} from "../../../src/modules/feature-extraction/index.js";

test("calculates source-IP distribution entropy for each trusted batch", async () => {
    const extractor = createExtractor();
    const events = [
        normalizedEvent("event-1", "192.0.2.10"),
        normalizedEvent("event-2", "192.0.2.10"),
        normalizedEvent("event-3", "198.51.100.20"),
        normalizedEvent("event-4", "198.51.100.20"),
    ];

    const result = await extractor.extract(events);

    assert.equal(result.totalEvents, 4);
    assert.deepEqual(
        result.events.map((event) => event.features.src_ip_entropy),
        [1, 1, 1, 1],
    );
    assert.deepEqual(Object.keys(result.events[0]?.features ?? {}), AI_FEATURE_NAMES);
});

test("does not mix entropy across organizations or Collector batches", async () => {
    const extractor = createExtractor();
    const events = [
        normalizedEvent("event-1", "192.0.2.10"),
        normalizedEvent("event-2", "198.51.100.20", { org_id: "org-002" }),
        normalizedEvent("event-3", "203.0.113.30", {
            ingestion: ingestion("batch-be-feat-01c-other"),
        }),
    ];

    const result = await extractor.extract(events);

    assert.deepEqual(
        result.events.map((event) => event.features.src_ip_entropy),
        [0, 0, 0],
    );
});

test("extracts OCSF traffic volume and calculates a finite ratio", async () => {
    const event = normalizedEvent("event-volume", "192.0.2.10", {
        unmapped: {
            traffic: { bytes_out: 120, bytes_in: 30 },
        },
    });

    const result = await createExtractor().extract([event]);
    const features = result.events[0]?.features;

    assert.equal(features?.bytes_sent, 120);
    assert.equal(features?.bytes_received, 30);
    assert.equal(features?.bytes_ratio, 4);
});

test("accepts preserved numeric strings and handles zero received bytes", async () => {
    const event = normalizedEvent("event-raw-volume", "192.0.2.10", {
        raw_event: { bytes_sent: "45", bytes_received: "0" },
    });

    const result = await createExtractor().extract([event]);
    const features = result.events[0]?.features;

    assert.equal(features?.bytes_sent, 45);
    assert.equal(features?.bytes_received, 0);
    assert.equal(features?.bytes_ratio, 45);
    assert.ok(Object.values(features ?? {}).every(Number.isFinite));
});

test("uses neutral volume and entropy values for absent or unsafe inputs", async () => {
    const event = normalizedEvent("event-defaults", undefined, {
        unmapped: {
            bytes_sent: -10,
            bytes_received: "not-a-number",
        },
    });

    const result = await createExtractor().extract([event]);
    const features = result.events[0]?.features;

    assert.equal(features?.src_ip_entropy, 0);
    assert.equal(features?.bytes_sent, 0);
    assert.equal(features?.bytes_received, 0);
    assert.equal(features?.bytes_ratio, 1);
});

test("calculates categorical Shannon entropy independently", () => {
    assert.equal(shannonDistributionEntropy([]), 0);
    assert.equal(shannonDistributionEntropy(["same", "same"]), 0);
    assert.equal(shannonDistributionEntropy(["a", "b", "c", "d"]), 2);
    assert.equal(shannonDistributionEntropy(["a", undefined, "a"]), 0);
});

function createExtractor(): BatchEntropyVolumeFeatureExtractor {
    return new BatchEntropyVolumeFeatureExtractor({
        delegate: new DeterministicFeatureExtractor(),
    });
}

function normalizedEvent(
    eventId: string,
    sourceIp: string | undefined,
    overrides: Partial<CreateNormalizedEventInput> = {},
): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: 4001,
        category_uid: 4,
        severity_id: 3,
        time: new Date("2026-09-18T10:00:00.000Z"),
        message: "Network event",
        ...(sourceIp === undefined ? {} : { src_endpoint: { ip: sourceIp } }),
        metadata: { version: "1.1.0" },
        ingestion: ingestion("batch-be-feat-01c"),
        org_id: "org-001",
        ...overrides,
    };
}

function ingestion(batchId: string): CreateNormalizedEventInput["ingestion"] {
    return {
        batch_id: batchId,
        collector_id: "collector-dev-01",
        ingested_at: new Date("2026-09-18T10:00:01.000Z"),
    };
}
