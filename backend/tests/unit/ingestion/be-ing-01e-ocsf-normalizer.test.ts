import assert from "node:assert/strict";
import test from "node:test";

import type {
    CollectorEvent,
    CollectorEventBatch,
} from "../../../src/modules/ingestion/domain/collector-contract.types.js";
import { OcsfCollectorEventNormalizer } from "../../../src/modules/ingestion/infrastructure/ocsf-collector-event.normalizer.js";

const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";
const COLLECTOR_ID = "collector-dev-01";
const EVENT_ID = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const INGESTED_AT = new Date("2026-09-08T00:00:00.000Z");
const ORG_ID = "organization-blue";

test("maps a verified baseline OCSF event without losing source identity", () => {
    const result = new OcsfCollectorEventNormalizer(ORG_ID).normalize(createBatch(), INGESTED_AT);

    assert.deepEqual(result.stats, {
        totalEvents: 1,
        schemaValid: 1,
        schemaInvalid: 0,
    });

    const normalized = result.events[0];
    assert.ok(normalized);
    assert.equal(normalized.event_id, EVENT_ID);
    assert.match(normalized.dedup_hash ?? "", /^sha256:[0-9a-f]{64}$/u);
    assert.equal(normalized.time.toISOString(), "2026-09-07T12:00:00.000Z");
    assert.equal(normalized.src_endpoint?.ip, "192.0.2.10");
    assert.equal(normalized.dst_endpoint?.hostname, "endpoint-01.example.local");
    assert.equal(normalized.actor?.user?.name, "alice");
    assert.equal(normalized.device?.hostname, "endpoint-01.example.local");
    assert.equal(normalized.ingestion.batch_id, BATCH_ID);
    assert.equal(normalized.ingestion.collector_id, COLLECTOR_ID);
    assert.equal(normalized.schema_valid, true);
    assert.deepEqual(normalized.validation_errors, []);
    assert.equal(normalized.raw_event?.event_id, EVENT_ID);
    assert.equal(normalized.org_id, ORG_ID);
});

test("uses a deterministic non-unique similarity hash while preserving stable event IDs", () => {
    const normalizer = new OcsfCollectorEventNormalizer(ORG_ID);
    const first = createEvent();
    const second = {
        ...createEvent(),
        event_id: "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        source: {
            ...createEvent().source,
            position: {
                ...createEvent().source.position,
                record_start_offset: 201,
                record_end_offset: 400,
            },
        },
    } satisfies CollectorEvent;

    const result = normalizer.normalize(createBatch([first, second]), INGESTED_AT);

    assert.equal(result.events[0]?.dedup_hash, result.events[1]?.dedup_hash);
    assert.notEqual(result.events[0]?.event_id, result.events[1]?.event_id);
});

function createBatch(events: readonly CollectorEvent[] = [createEvent()]): CollectorEventBatch {
    return {
        contract_version: "1.0.0",
        message_type: "event_batch",
        collector_id: COLLECTOR_ID,
        integrity: {
            algorithm: "HMAC-SHA256",
            key_id: "collector-key-01",
            value: "A".repeat(43),
        },
        batch_id: BATCH_ID,
        created_at: "2026-09-07T12:00:01.000Z",
        ocsf_schema_version: "1.1.0",
        event_count: events.length,
        events,
    };
}

function createEvent(): CollectorEvent {
    const eventTime = "2026-09-07T12:00:00.000Z";

    return {
        event_id: EVENT_ID,
        source: {
            source_id: "simulated-auth-log",
            adapter_type: "file",
            upstream_sender_id: null,
            original_endpoint_id: "endpoint-01.example.local",
            upstream_event_id: null,
            position: {
                file_identity: "auth.log:fixture-01",
                record_start_offset: 0,
                record_end_offset: 200,
            },
        },
        event_time: eventTime,
        received_time: "2026-09-07T12:00:00.100Z",
        content_type: "application/json",
        raw_payload:
            '{"endpoint_id":"endpoint-01.example.local","timestamp":"2026-09-07T12:00:00.000Z","event_type":"login_failed","username":"alice","source_ip":"192.0.2.10"}',
        mapping: {
            name: "trivikrama.simulated-auth",
            version: "1.0.0",
        },
        ocsf: {
            activity_id: 1,
            category_uid: 3,
            class_uid: 3002,
            type_uid: 300201,
            time: Date.parse(eventTime),
            message: "Failed login for alice",
            metadata: {
                version: "1.1.0",
                product: {
                    name: "Trivikrama Collector",
                    vendor_name: "Trivikrama",
                },
            },
            src_endpoint: { ip: "192.0.2.10" },
            dst_endpoint: { hostname: "endpoint-01.example.local" },
            user: { name: "alice" },
            unmapped: { source_format: "simulated-auth" },
            status_id: 2,
            severity_id: 3,
        },
    };
}

