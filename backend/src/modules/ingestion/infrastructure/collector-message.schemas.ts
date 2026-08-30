import { z } from "zod";

import type { CollectorMessage, JsonValue } from "../domain/collector-contract.types.js";

import type { ICollectorMessageSchemaValidator } from "../domain/collector-verification.contracts.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../domain/collector-verification.errors.js";

const collectorId = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/);

const sourceId = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/);

const uuidV4 = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const timestamp = z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/);

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const integrity = z
    .object({
        algorithm: z.literal("HMAC-SHA256"),
        key_id: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[A-Za-z0-9._-]+$/),
        value: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict();

const filePosition = z
    .object({
        file_identity: z.string().min(1).max(256),
        record_start_offset: safeInteger,
        record_end_offset: safeInteger,
    })
    .strict();

const eventSource = z
    .object({
        source_id: sourceId,
        adapter_type: z.literal("file"),
        upstream_sender_id: z.string().min(1).max(256).nullable(),
        original_endpoint_id: z.string().min(1).max(253),
        upstream_event_id: z.string().min(1).max(256).nullable(),
        position: filePosition,
    })
    .strict();

const mapping = z
    .object({
        name: z.literal("trivikrama.simulated-auth"),
        version: z.literal("1.0.0"),
    })
    .strict();

const ocsfAuthentication = z
    .object({
        activity_id: z.literal(1),
        category_uid: z.literal(3),
        class_uid: z.literal(3002),
        severity_id: z.union([z.literal(1), z.literal(3)]),
        status_id: z.union([z.literal(1), z.literal(2)]),
        time: safeInteger,
        type_uid: z.literal(300201),
        message: z.string().min(1).max(4096),

        metadata: z
            .object({
                version: z.literal("1.1.0"),
                product: z
                    .object({
                        name: z.literal("Trivikrama Collector"),
                        vendor_name: z.literal("Trivikrama"),
                    })
                    .strict(),
            })
            .strict(),

        src_endpoint: z
            .object({
                ip: z.string().min(2).max(45),
            })
            .strict(),

        dst_endpoint: z
            .object({
                hostname: z.string().min(1).max(253),
            })
            .strict(),

        user: z
            .object({
                name: z.string().min(1).max(256),
            })
            .strict(),

        unmapped: z.record(z.string(), z.unknown()),
    })
    .strict();

const event = z
    .object({
        event_id: sha256,
        source: eventSource,
        event_time: timestamp,
        received_time: timestamp,
        content_type: z.literal("application/json"),
        raw_payload: z.string().min(2),
        mapping,
        ocsf: ocsfAuthentication,
    })
    .strict();

const eventBatch = z
    .object({
        contract_version: z.literal("1.0.0"),
        message_type: z.literal("event_batch"),
        batch_id: uuidV4,
        collector_id: collectorId,
        created_at: timestamp,
        ocsf_schema_version: z.literal("1.1.0"),
        event_count: z.number().int().min(1).max(1000),
        events: z.array(event).min(1).max(1000),
        integrity,
    })
    .strict();

const heartbeatMetrics = z
    .object({
        events_received: safeInteger,
        events_published: safeInteger,
        events_rejected: safeInteger,
        events_lost_best_effort: safeInteger,

        queue_events: safeInteger,
        queue_bytes: safeInteger,

        outbox_batches: safeInteger,
        outbox_bytes: safeInteger,

        last_batch_id: uuidV4.nullable(),

        cpu_percent: z.number().refine(Number.isFinite).min(0).max(100),

        memory_bytes: safeInteger,
        disk_available_bytes: safeInteger,
    })
    .strict();

const heartbeat = z
    .object({
        contract_version: z.literal("1.0.0"),
        message_type: z.literal("heartbeat"),
        collector_id: collectorId,
        sequence: safeInteger,
        timestamp,
        started_at: timestamp,
        collector_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
        configuration_version: z.string().min(1).max(128),
        status: z.string().min(1).max(32),
        metrics: heartbeatMetrics,
        integrity,
    })
    .strict();

const rejectedSource = z
    .object({
        source_id: sourceId,
        adapter_type: z.literal("file"),
        file_identity: z.string().min(1).max(256),
        record_start_offset: safeInteger,
        record_end_offset: safeInteger,
    })
    .strict();

const rejection = z
    .object({
        stage: z.enum(["input_validation", "mapping", "ocsf_validation"]),
        code: z.enum([
            "invalid_json",
            "invalid_utf8",
            "missing_required_field",
            "invalid_field_type",
            "invalid_timestamp",
            "invalid_ip_address",
            "unsupported_event_type",
            "record_too_large",
            "mapping_failed",
            "ocsf_validation_failed",
        ]),
        message: z.string().min(1).max(1024),
    })
    .strict()
    .refine(
        (value) =>
            (value.stage === "mapping" && value.code === "mapping_failed") ||
            (value.stage === "ocsf_validation" && value.code === "ocsf_validation_failed") ||
            (value.stage === "input_validation" &&
                value.code !== "mapping_failed" &&
                value.code !== "ocsf_validation_failed"),
        {
            message: "Rejection stage and code do not match.",
        },
    );

const rejectedPayload = z
    .object({
        content_type: z.enum(["application/json", "application/octet-stream"]),
        byte_length: safeInteger,
        sha256,
        capture_encoding: z.literal("base64"),
        capture: z
            .string()
            .max(87384)
            .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
        capture_truncated: z.boolean(),
    })
    .strict();

const rejectedEvent = z
    .object({
        contract_version: z.literal("1.0.0"),
        message_type: z.literal("rejected_event"),
        rejection_id: uuidV4,
        collector_id: collectorId,
        rejected_at: timestamp,
        source: rejectedSource,
        rejection,
        payload: rejectedPayload,
        integrity,
    })
    .strict();

const collectorMessage = z.discriminatedUnion("message_type", [
    eventBatch,
    heartbeat,
    rejectedEvent,
]);

export class CollectorMessageSchemaValidator implements ICollectorMessageSchemaValidator {
    public validate(value: JsonValue): CollectorMessage {
        const result = collectorMessage.safeParse(value);

        if (!result.success) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
                "schema",
                "Collector message failed schema validation.",
            );
        }

        return result.data as CollectorMessage;
    }
}
