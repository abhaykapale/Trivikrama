// -----------------------------------------------------------------------------
// Common JSON types
// -----------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

// -----------------------------------------------------------------------------
// Common Collector contract values
// -----------------------------------------------------------------------------

export type CollectorContractVersion = "1.0.0";

export type CollectorMessageType = "event_batch" | "heartbeat" | "rejected_event";

export type CollectorIntegrityAlgorithm = "HMAC-SHA256";

export type CollectorAdapterType = "file";

export interface CollectorIntegrity {
    readonly algorithm: CollectorIntegrityAlgorithm;
    readonly key_id: string;
    readonly value: string;
}

export interface CollectorEnvelope {
    readonly contract_version: CollectorContractVersion;
    readonly message_type: CollectorMessageType;
    readonly collector_id: string;
    readonly integrity: CollectorIntegrity;
}

// -----------------------------------------------------------------------------
// File-source identity
// -----------------------------------------------------------------------------

export interface FileSourcePosition {
    readonly file_identity: string;
    readonly record_start_offset: number;
    readonly record_end_offset: number;
}

export interface CollectorEventSource {
    readonly source_id: string;
    readonly adapter_type: CollectorAdapterType;
    readonly upstream_sender_id: string | null;
    readonly original_endpoint_id: string;
    readonly upstream_event_id: string | null;
    readonly position: FileSourcePosition;
}

export interface CollectorMappingIdentity {
    readonly name: "trivikrama.simulated-auth";
    readonly version: "1.0.0";
}

// -----------------------------------------------------------------------------
// OCSF Authentication 1.1.0
// -----------------------------------------------------------------------------

export interface OcsfProduct {
    readonly name: "Trivikrama Collector";
    readonly vendor_name: "Trivikrama";
}

export interface OcsfMetadata {
    readonly version: "1.1.0";
    readonly product: OcsfProduct;
}

export interface OcsfSourceEndpoint {
    readonly ip: string;
}

export interface OcsfDestinationEndpoint {
    readonly hostname: string;
}

export interface OcsfUser {
    readonly name: string;
}

export interface OcsfAuthenticationBase {
    readonly activity_id: 1;
    readonly category_uid: 3;
    readonly class_uid: 3002;
    readonly type_uid: 300201;

    readonly time: number;
    readonly message: string;

    readonly metadata: OcsfMetadata;
    readonly src_endpoint: OcsfSourceEndpoint;
    readonly dst_endpoint: OcsfDestinationEndpoint;
    readonly user: OcsfUser;

    readonly unmapped: JsonObject;
}

export type OcsfAuthenticationOutcome =
    | {
          readonly status_id: 1;
          readonly severity_id: 1;
      }
    | {
          readonly status_id: 2;
          readonly severity_id: 3;
      };

export type OcsfAuthenticationEvent = OcsfAuthenticationBase & OcsfAuthenticationOutcome;

// -----------------------------------------------------------------------------
// Collector event and batch
// -----------------------------------------------------------------------------

export interface CollectorEvent {
    readonly event_id: string;
    readonly source: CollectorEventSource;

    readonly event_time: string;
    readonly received_time: string;

    readonly content_type: "application/json";
    readonly raw_payload: string;

    readonly mapping: CollectorMappingIdentity;
    readonly ocsf: OcsfAuthenticationEvent;
}

export interface CollectorEventBatch extends CollectorEnvelope {
    readonly message_type: "event_batch";

    readonly batch_id: string;
    readonly created_at: string;
    readonly ocsf_schema_version: "1.1.0";

    readonly event_count: number;
    readonly events: readonly CollectorEvent[];
}

// -----------------------------------------------------------------------------
// Collector heartbeat
// -----------------------------------------------------------------------------

export type CollectorHeartbeatStatus = "online" | "degraded" | "shutting_down";

export interface CollectorHeartbeatMetrics {
    readonly events_received: number;
    readonly events_published: number;
    readonly events_rejected: number;
    readonly events_lost_best_effort: number;

    readonly queue_events: number;
    readonly queue_bytes: number;

    readonly outbox_batches: number;
    readonly outbox_bytes: number;

    readonly last_batch_id: string | null;

    readonly cpu_percent: number;
    readonly memory_bytes: number;
    readonly disk_available_bytes: number;
}

export interface CollectorHeartbeat extends CollectorEnvelope {
    readonly message_type: "heartbeat";

    readonly sequence: number;
    readonly timestamp: string;
    readonly started_at: string;

    readonly collector_version: string;
    readonly configuration_version: string;
    readonly status: CollectorHeartbeatStatus;

    readonly metrics: CollectorHeartbeatMetrics;
}

// -----------------------------------------------------------------------------
// Rejected Collector event
// -----------------------------------------------------------------------------

export type CollectorInputRejectionCode =
    | "invalid_json"
    | "invalid_utf8"
    | "missing_required_field"
    | "invalid_field_type"
    | "invalid_timestamp"
    | "invalid_ip_address"
    | "unsupported_event_type"
    | "record_too_large";

export type CollectorRejection =
    | {
          readonly stage: "input_validation";
          readonly code: CollectorInputRejectionCode;
          readonly message: string;
      }
    | {
          readonly stage: "mapping";
          readonly code: "mapping_failed";
          readonly message: string;
      }
    | {
          readonly stage: "ocsf_validation";
          readonly code: "ocsf_validation_failed";
          readonly message: string;
      };

export interface RejectedEventSource {
    readonly source_id: string;
    readonly adapter_type: "file";
    readonly file_identity: string;
    readonly record_start_offset: number;
    readonly record_end_offset: number;
}

export type RejectedPayloadContentType = "application/json" | "application/octet-stream";

export interface RejectedEventPayload {
    readonly content_type: RejectedPayloadContentType;
    readonly byte_length: number;
    readonly sha256: string;

    readonly capture_encoding: "base64";
    readonly capture: string;
    readonly capture_truncated: boolean;
}

export interface CollectorRejectedEvent extends CollectorEnvelope {
    readonly message_type: "rejected_event";

    readonly rejection_id: string;
    readonly rejected_at: string;

    readonly source: RejectedEventSource;
    readonly rejection: CollectorRejection;
    readonly payload: RejectedEventPayload;
}

// -----------------------------------------------------------------------------
// Complete Collector message union
// -----------------------------------------------------------------------------

export type CollectorMessage = CollectorEventBatch | CollectorHeartbeat | CollectorRejectedEvent;
