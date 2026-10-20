import { createHash } from "node:crypto";

import { isIP } from "node:net";

import type {
    CollectorEvent,
    CollectorEventBatch,
    CollectorMessage,
    JsonObject,
} from "../domain/collector-contract.types.js";

import type {
    ICollectorMessageSemanticValidator,
    IStrictJsonParser,
} from "../domain/collector-verification.contracts.js";

import { StrictJsonParser } from "./json/strict-json.parser.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../domain/collector-verification.errors.js";

const RFC3339_UTC_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const RFC3339_WITH_TIMEZONE =
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

export class CollectorMessageSemanticValidator implements ICollectorMessageSemanticValidator {
    private readonly rawPayloadParser: IStrictJsonParser;

    public constructor(rawPayloadParser: IStrictJsonParser = new StrictJsonParser()) {
        this.rawPayloadParser = rawPayloadParser;
    }

    public validate(message: CollectorMessage): void {
        switch (message.message_type) {
            case "event_batch":
                this.validateEventBatch(message);
                return;

            case "heartbeat":
                this.validateHeartbeat(message);
                return;

            case "rejected_event":
                this.validateRejectedEvent(message);
                return;
        }
    }

    private validateEventBatch(batch: CollectorEventBatch): void {
        if (batch.event_count !== batch.events.length) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.EVENT_COUNT_MISMATCH,
                "event_count does not equal the number of events.",
            );
        }

        const eventIds = new Set<string>();

        for (const event of batch.events) {
            if (eventIds.has(event.event_id)) {
                this.fail(
                    COLLECTOR_VERIFICATION_ERROR_CODES.DUPLICATE_EVENT_ID,
                    "Batch contains duplicate event IDs.",
                    { eventId: event.event_id },
                );
            }

            eventIds.add(event.event_id);
            this.validateEvent(event);
        }
    }

    private validateEvent(event: CollectorEvent): void {
        const position = event.source.position;

        if (position.record_end_offset <= position.record_start_offset) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_SOURCE_POSITION,
                "Event record end offset must be greater than its start offset.",
                { eventId: event.event_id },
            );
        }

        const expectedEventId = this.calculateEventId(
            event.source.source_id,
            position.file_identity,
            position.record_start_offset,
        );

        if (event.event_id !== expectedEventId) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.EVENT_IDENTITY_MISMATCH,
                "Event ID does not match its source identity.",
                { eventId: event.event_id },
            );
        }

        if (!RFC3339_UTC_MILLIS.test(event.event_time)) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP,
                "Event timestamp is not valid UTC millisecond precision.",
                { eventId: event.event_id },
            );
        }

        const eventTime = Date.parse(event.event_time);

        if (!Number.isFinite(eventTime)) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP,
                "Event timestamp is not a real calendar timestamp.",
                { eventId: event.event_id },
            );
        }

        if (event.ocsf.time !== eventTime) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                "OCSF time does not match event_time.",
                { eventId: event.event_id },
            );
        }

        if (isIP(event.ocsf.src_endpoint.ip) === 0) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_IP_ADDRESS,
                "OCSF source endpoint does not contain a valid IP address.",
                { eventId: event.event_id },
            );
        }

        let rawPayload: JsonObject;

        try {
            const parsed = this.rawPayloadParser.parse(new TextEncoder().encode(event.raw_payload));

            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                throw new Error("Raw payload is not an object.");
            }

            rawPayload = parsed as JsonObject;
        } catch {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                "Raw payload is not valid JSON.",
                { eventId: event.event_id },
            );
        }

        const endpointId = this.requiredString(rawPayload, "endpoint_id", event.event_id);

        const timestamp = this.requiredString(rawPayload, "timestamp", event.event_id);

        const eventType = this.requiredString(rawPayload, "event_type", event.event_id);

        const username = this.requiredString(rawPayload, "username", event.event_id);

        const sourceIp = this.requiredString(rawPayload, "source_ip", event.event_id);

        const sourceTimestamp = Date.parse(timestamp);

        if (!RFC3339_WITH_TIMEZONE.test(timestamp) || !Number.isFinite(sourceTimestamp)) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP,
                "Raw payload timestamp is not valid RFC 3339 with a timezone.",
                { eventId: event.event_id },
            );
        }

        if (
            endpointId !== event.source.original_endpoint_id ||
            endpointId !== event.ocsf.dst_endpoint.hostname
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                "Endpoint identity is inconsistent across the event.",
                { eventId: event.event_id },
            );
        }

        if (
            sourceTimestamp !== eventTime ||
            username !== event.ocsf.user.name ||
            sourceIp !== event.ocsf.src_endpoint.ip
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                "OCSF fields do not match the raw source payload.",
                { eventId: event.event_id },
            );
        }

        if (eventType === "login_success") {
            if (
                event.ocsf.status_id !== 1 ||
                event.ocsf.severity_id !== 1 ||
                event.ocsf.message !== `Successful login for ${username}`
            ) {
                this.fail(
                    COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                    "Successful-login OCSF mapping is inconsistent.",
                    { eventId: event.event_id },
                );
            }

            return;
        }

        if (eventType === "login_failed") {
            if (
                event.ocsf.status_id !== 2 ||
                event.ocsf.severity_id !== 3 ||
                event.ocsf.message !== `Failed login for ${username}`
            ) {
                this.fail(
                    COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                    "Failed-login OCSF mapping is inconsistent.",
                    { eventId: event.event_id },
                );
            }

            return;
        }

        this.fail(
            COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
            "Raw payload contains an unsupported event type.",
            { eventId: event.event_id },
        );
    }

    private validateHeartbeat(message: CollectorMessage): void {
        if (message.message_type !== "heartbeat") {
            return;
        }

        if (
            !RFC3339_UTC_MILLIS.test(message.timestamp) ||
            !RFC3339_UTC_MILLIS.test(message.started_at)
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HEARTBEAT,
                "Heartbeat contains an invalid timestamp.",
            );
        }

        const heartbeatAt = Date.parse(message.timestamp);
        const startedAt = Date.parse(message.started_at);

        if (
            !Number.isFinite(heartbeatAt) ||
            !Number.isFinite(startedAt) ||
            new Date(heartbeatAt).toISOString() !== message.timestamp ||
            new Date(startedAt).toISOString() !== message.started_at
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HEARTBEAT,
                "Heartbeat contains a timestamp that is not a real calendar time.",
            );
        }

        if (startedAt > heartbeatAt) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HEARTBEAT,
                "Heartbeat start time must not be later than its observation time.",
            );
        }

        if (
            message.status !== "online" &&
            message.status !== "degraded" &&
            message.status !== "shutting_down"
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HEARTBEAT,
                "Heartbeat contains an unsupported status.",
            );
        }

        if (message.metrics.cpu_percent < 0 || message.metrics.cpu_percent > 100) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HEARTBEAT,
                "Heartbeat CPU percentage is outside the valid range.",
            );
        }
    }

    private validateRejectedEvent(message: CollectorMessage): void {
        if (message.message_type !== "rejected_event") {
            return;
        }

        const payloadBytes = Buffer.from(message.payload.capture, "base64");

        if (!message.payload.capture_truncated) {
            const actualDigest = createHash("sha256").update(payloadBytes).digest("hex");
            const expectedDigest = `sha256:${actualDigest}`;

            if (message.payload.sha256 !== expectedDigest) {
                this.fail(
                    COLLECTOR_VERIFICATION_ERROR_CODES.REJECTION_PAYLOAD_MISMATCH,
                    "Rejected payload SHA-256 does not match its complete capture.",
                );
            }
        }

        if (
            !message.payload.capture_truncated &&
            payloadBytes.length !== message.payload.byte_length
        ) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.REJECTION_PAYLOAD_MISMATCH,
                "Rejected payload byte length does not match its capture.",
            );
        }

        if (message.payload.capture_truncated && payloadBytes.length > 65536) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.REJECTION_PAYLOAD_MISMATCH,
                "Rejected payload capture exceeds the truncation limit.",
            );
        }

        if (message.source.record_end_offset <= message.source.record_start_offset) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_SOURCE_POSITION,
                "Rejected-event record offsets are invalid.",
            );
        }
    }

    private requiredString(object: JsonObject, propertyName: string, eventId: string): string {
        const value = object[propertyName];

        if (typeof value !== "string" || value.length === 0) {
            this.fail(
                COLLECTOR_VERIFICATION_ERROR_CODES.OCSF_MAPPING_MISMATCH,
                `Raw payload field '${propertyName}' is invalid.`,
                { eventId },
            );
        }

        return value;
    }

    private calculateEventId(
        sourceId: string,
        fileIdentity: string,
        recordStartOffset: number,
    ): string {
        const identityInput = `${sourceId}\n${fileIdentity}\n${recordStartOffset}`;

        const digest = createHash("sha256")
            .update(new TextEncoder().encode(identityInput))
            .digest("hex");

        return `sha256:${digest}`;
    }

    private fail(
        code: keyof typeof COLLECTOR_VERIFICATION_ERROR_CODES extends never
            ? never
            : (typeof COLLECTOR_VERIFICATION_ERROR_CODES)[keyof typeof COLLECTOR_VERIFICATION_ERROR_CODES],
        message: string,
        details?: Record<string, unknown>,
    ): never {
        throw new CollectorVerificationError(code, "semantics", message, details);
    }
}
