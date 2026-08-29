# ARCH-01 — Collector-to-Backend Ingress Contract

| Field | Value |
|---|---|
| Status | Approved |
| Contract version | 1.0.0 |
| OCSF version | 1.1.0 |
| Initial mapping | `trivikrama.simulated-auth` 1.0.0 |
| Initial ingress | Append-only UTF-8 JSONL file |
| Handoff | Signed atomic files on a shared filesystem |

## 1. Authority and scope

This document is the authoritative ARCH-01 contract between the C++ Collector and Node.js backend. It combines the original Collector design with the corrections in `Finalcollector.md.md`.

For this boundary, it supersedes older text that:

- makes HMAC optional;
- permits checkpoint advancement after memory enqueue;
- drops reliable events when queues are full;
- permits partial acceptance of an invalid signed batch;
- identifies batches by timestamp and counter;
- uses a shared `heartbeat.json` across Collectors.

The first vertical slice is intentionally limited to a simulated JSONL `FileReader`. WEF, syslog, and HTTPS readers are deferred. Rules, AI, enrichment, correlation, incidents, and frontend monitoring are backend work outside ARCH-01.

## 2. Selected architecture

```text
simulation/events.jsonl
  -> FileReader
  -> source-preserving RawEvent
  -> trivikrama.simulated-auth mapping
  -> bounded RAM batch assembly
  -> durable Collector outbox
  -> signed atomic event-batch file
  -> COLLECTOR_DIR/incoming/<collector_id>
  -> backend claim, verify, queue, archive, persist
```

The Collector never writes to PostgreSQL, MongoDB, or Redis. The backend does not own source checkpoints. Human JWT/session authentication is not used for the Collector machine identity.

## 3. Input record and mapping profile

Each complete UTF-8 JSONL line is one input record:

```json
{
  "endpoint_id": "server-01",
  "timestamp": "2026-08-29T10:00:00.000Z",
  "event_type": "login_failed",
  "username": "admin",
  "source_ip": "192.168.1.50"
}
```

Required validation:

| Field | Rule | OCSF 1.1.0 destination |
|---|---|---|
| `endpoint_id` | Non-empty string, at most 253 characters | `dst_endpoint.hostname` |
| `timestamp` | RFC 3339 with timezone; normalized to UTC millisecond form | `time` as Unix epoch milliseconds |
| `event_type` | `login_success` or `login_failed` | Authentication activity/status |
| `username` | Non-empty string, at most 256 characters | `user.name` |
| `source_ip` | Valid IPv4 or IPv6 | `src_endpoint.ip` |
| Other keys | Any valid JSON value | `unmapped` |

The Collector MUST preserve the exact line content, excluding the JSONL line delimiter, as `raw_payload`. It MUST NOT normalize whitespace, key order, or Unicode inside `raw_payload`.

Both event types map to OCSF Authentication class 3002:

| Field | Value |
|---|---:|
| `category_uid` | 3 |
| `class_uid` | 3002 |
| `activity_id` | 1 (Logon) |
| `type_uid` | 300201 |
| `metadata.version` | `1.1.0` |

Outcome mapping:

| Source type | `status_id` | `severity_id` | Message template |
|---|---:|---:|---|
| `login_success` | 1 (Success) | 1 (Informational) | `Successful login for <username>` |
| `login_failed` | 2 (Failure) | 3 (Medium) | `Failed login for <username>` |

The severity is the source event baseline, not an incident risk score. Invalid timestamps are rejected, not replaced with receipt time. Unknown event types are rejected, not mapped to a generic class. A mapping change requires a new mapping version.

The backend MUST validate the pinned mapping profile and OCSF invariants before enqueueing the batch. Full upstream OCSF schema artifacts may be vendored later, but they MUST be pinned to 1.1.0 rather than fetched dynamically at runtime.

## 4. Stable identity

For the initial file source:

```text
event_id = "sha256:" + lowercase_hex(
  SHA-256(UTF8(source_id + "\n" + file_identity + "\n" + decimal(record_start_offset)))
)
```

The delimiters and decimal representation are exact. `record_start_offset` has no leading zeros. This identity is stable when the same physical record is reread after a crash.

`batch_id` and `rejection_id` are lowercase canonical UUID v4 strings generated from a cryptographically secure random source. An identifier is never reused.

For content comparison:

```text
source_event_digest = "sha256:" + lowercase_hex(SHA-256(UTF8(raw_payload)))
batch_digest = "sha256:" + lowercase_hex(SHA-256(RFC8785(unsigned_batch)))
```

The domain-separation prefix used for HMAC is not part of `batch_digest`.

## 5. Batch envelope

The normative schema is `contracts/collector-ingress/v1/schemas/event-batch.schema.json`.

Additional semantic rules not expressible in plain JSON Schema:

- `event_count` MUST equal `events.length`.
- Events in one batch MUST have unique `event_id` values.
- `record_end_offset` MUST be greater than `record_start_offset`.
- `ocsf.time` MUST equal the Unix epoch milliseconds represented by `event_time`.
- OCSF status and severity MUST match the source `event_type` in `raw_payload`.
- `source.original_endpoint_id` MUST equal the validated `endpoint_id`.
- `ocsf.dst_endpoint.hostname`, `ocsf.user.name`, and `ocsf.src_endpoint.ip` MUST equal the mapped source fields.
- A raw payload is limited to 512 KiB measured as UTF-8 bytes.
- A batch is limited to 1,000 events and 8 MiB measured as the final signed UTF-8 file.
- Empty batches are forbidden.

A batch flushes on the first of 1,000 events, 8 MiB encoded size, 5 seconds dwell time, or graceful shutdown.

## 6. Canonical JSON and HMAC

All batches, heartbeats, and rejected-event records are signed. HMAC is mandatory in every environment; only the key source differs between test and production.

The signed input is constructed as follows:

1. Parse strict I-JSON. Reject duplicate keys, invalid UTF-8, a BOM, lone Unicode surrogates, non-finite numbers, and unsafe integer values.
2. Copy the complete document.
3. Remove only `integrity.value`; retain `integrity.algorithm` and `integrity.key_id`.
4. Canonicalize the copied object using RFC 8785 JCS.
5. Encode the exact ASCII prefix `TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n` as UTF-8.
6. Compute HMAC-SHA256 over `prefix || canonical_unsigned_bytes`.
7. Encode the 32-byte MAC using unpadded base64url and store it in `integrity.value`.

RFC 8785 preserves array order, recursively sorts object property names by unsigned UTF-16 code units, emits no inter-token whitespace, uses ECMAScript primitive serialization, and emits UTF-8 bytes. Unicode strings are preserved as-is; no Unicode normalization is performed.

`COLLECTOR_HMAC_SECRET` is exactly 64 unpadded base64url characters that decode to exactly 48 random bytes. It MUST come from protected runtime secret configuration, never from a batch, log, repository, or command-line argument. `key_id` selects a provisioned key and is not secret.

Verification uses a 32-byte constant-time comparison after successful base64url decoding. Unknown `key_id`, an unsupported algorithm, or a malformed signature is a terminal integrity failure.

## 7. Directory ownership and atomic durability

```text
simulation/
  events.jsonl

COLLECTOR_STATE_DIR/<collector_id>/
  checkpoint.json
  outbox/
  rejected/

COLLECTOR_DIR/
  incoming/<collector_id>/batch_<uuid>.json
  heartbeat/<collector_id>.json
  processing/
  quarantine/
```

The Collector owns only its state directory, its identity-scoped incoming directory, and its heartbeat file. The backend owns `processing` and `quarantine`.

`COLLECTOR_STATE_DIR` and `COLLECTOR_DIR` MUST reside on the same filesystem for outbox-to-incoming rename. The backend requires read/write access to the handoff volume so it can claim into `processing`; the older deployment example mounting this volume read-only is incompatible with ARCH-01 and must be corrected when ingestion is implemented.

For a batch or rejection, durable publication is:

1. write a temporary file on the same filesystem;
2. flush userspace buffers;
3. `fsync` the file;
4. close it;
5. atomically rename it to the final path;
6. `fsync` the destination directory;
7. only then commit the covered source checkpoint.

Heartbeat replacement uses the same temporary-write, file-`fsync`, atomic-rename, and directory-`fsync` sequence. The backend ignores temporary files and symlinks.

## 8. Checkpoints

The Collector distinguishes read, sealed, and committed positions. Restart recovery uses only committed positions. A checkpoint never advances because an event entered RAM or a batch was merely assembled.

If publication succeeds and checkpoint persistence fails, the Collector may replay the records. The backend MUST treat identical replay as success through stable IDs and digests.

File rotation/replacement produces a new `file_identity`. The old identity is drained through its last complete line before switching when still accessible. A partial trailing line is not consumed until completed.

## 9. Outbox capacity and exhaustion

Pending capacity includes sealed outbox files plus published files awaiting backend ownership in `incoming/<collector_id>`.

| Limit | Default |
|---|---:|
| Pending bytes | 10 GiB |
| Pending batches | 10,000 |
| High-water | 80% |
| Critical | 95% |
| Filesystem reserve | 256 MiB |
| Rejected store | 1 GiB |
| RAM events | 100,000 |
| RAM bytes | 256 MiB |

The effective limit is the first reached byte, batch, RAM, or filesystem-reserve boundary.

- Below 80%: normal operation.
- At or above 80%: status becomes `degraded`, intake is reduced, publishing is prioritized.
- At or above 95%: reliable sources pause before reading another record.
- At a hard limit: no additional batch is sealed and no checkpoint advances.
- Automatic resume occurs only after utilization falls below 80%, preventing threshold oscillation.

The Collector never deletes, overwrites, or evicts pending batches. Publication retries use 1, 2, 4, 8, 16, 32, then 60 seconds maximum with plus or minus 20 percent jitter. UDP loss policy is deferred because UDP is not in the first slice.

## 10. Rejected-event outcome

The normative schema is `rejected-event.schema.json`. Allowed codes are:

```text
invalid_json invalid_utf8 missing_required_field invalid_field_type
invalid_timestamp invalid_ip_address unsupported_event_type record_too_large
mapping_failed ocsf_validation_failed
```

One source record creates one immutable `rejected_<rejection_id>.json`. It uses the same signing and durability rules. Payloads at or below 64 KiB are captured completely. Larger payloads capture the first 65,536 bytes, set `capture_truncated` to true, and retain the full byte count and SHA-256 digest.

The source checkpoint advances past the record only after the rejection file is durable. If rejected storage is full, the source pauses. Rejections are terminal and are not automatically retried.

## 11. Heartbeat

The normative schema is `heartbeat.schema.json`.

- Default interval: 30 seconds.
- `sequence` is monotonically increasing during one Collector process lifetime.
- Emitted status: `online`, `degraded`, or `shutting_down`.
- The backend derives `offline`; the Collector never emits it.
- No valid heartbeat for more than 60 seconds means offline for contract v1.
- A stale sequence or timestamp, invalid HMAC, or unknown Collector does not update status.

`events_received = events_published + events_rejected + queue_events` is not a valid universal invariant because batching and in-flight publication create intermediate states. Counters are monotonically non-decreasing within a process lifetime and reset when `started_at` changes.

## 12. Backend processing semantics

### A. Collector publication success

Success requires signed file `fsync`, atomic rename into `incoming`, and destination-directory `fsync`. Only then may the checkpoint advance. Backend processing has not yet succeeded.

### B. Backend intake success

Success requires atomic claim into `processing`, safe regular-file checks, pre-parse size enforcement, strict I-JSON parsing, supported contract version, known Collector/key, valid HMAC, complete batch/OCSF validation, and a durable BullMQ job whose job ID is `batch_id`. The processing file remains durable.

Validation order is security-significant: cheap path/type/size checks first; strict parse; envelope/algorithm/key selection; HMAC verification; then detailed semantic validation. No unverified content is archived as trusted or queued for processing.

### C. Backend ingestion success

All conditions are required:

1. Raw batch archive exists under unique `batch_id` with `batch_digest`.
2. Every event reaches one terminal storage outcome: inserted, or existing with the same `event_id` and identical `source_event_digest`.
3. Inserted plus identical duplicate outcomes equals `event_count`.
4. Raw archive state is `complete`.

The same `batch_id` and digest is idempotent success. The same `event_id` and source digest is idempotent success.

The following are terminal whole-batch integrity failures: same batch ID with different digest; same event ID with different source digest; invalid signature; unknown Collector/key; event-count mismatch; invalid event; OCSF inconsistency. Partial acceptance is forbidden. If a process crashes after partial inserts, retry completes idempotently; the archive is not marked complete early.

### D. Backend finalization success

After ingestion success, the backend removes the processing file, completes the BullMQ job, and records metrics. A failure during file removal or queue acknowledgement is retryable because storage operations are idempotent.

Rule evaluation, AI, correlation, and incident generation consume successfully normalized events downstream and do not redefine ingestion success.

## 13. Failure classification

| Failure | Outcome |
|---|---|
| MongoDB, Redis, or temporary filesystem unavailable | Retry with bounded exponential backoff |
| Crash during database writes | Retry idempotently |
| Invalid HMAC, unknown Collector/key | Immediate quarantine; security signal |
| Contract or OCSF violation | Immediate quarantine |
| Batch/event identity collision with different digest | Immediate quarantine; security signal |
| Retry budget exhausted | Dead-letter plus quarantine |
| Backend restart with file in `processing` | Recover and retry |

Quarantine preserves the original claimed bytes and writes separate backend-owned reason metadata. It never rewrites the untrusted file.

## 14. Contract evolution

Consumers reject unsupported major contract versions. A backward-compatible optional field requires a minor version and corresponding schemas/fixtures. Breaking field, signing, identity, or semantic changes require a new major contract directory. Mapping and OCSF versions evolve independently and remain explicit in every event/batch.

## 15. Acceptance tests

Before either runtime is considered compatible, it MUST pass the shared fixtures for:

- stable event identity;
- RFC 8785 canonical bytes;
- HMAC signing and constant-time verification;
- valid batch, heartbeat, and rejection;
- duplicate-key, tamper, count mismatch, OCSF inconsistency, and size rejection;
- same-ID/same-digest idempotency;
- same-ID/different-digest quarantine;
- crash points before/after publication and before/after checkpoint;
- outbox high-water, critical-water, hard-limit, and resume hysteresis.

The included Node verifier is a contract oracle for the fixtures, not the production backend ingestion implementation.

## 16. External normative references

- [OCSF Authentication class](https://github.com/ocsf/ocsf-schema/blob/main/events/iam/authentication.json) and [official OCSF 1.1.0 Authentication example](https://github.com/ocsf/examples/blob/main/mappings/markdown/AWS/v1.1.0/CloudTrail/Authentication/samples/authentication.ocsf): class 3002, Logon activity 1, IAM category 3.
- [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html).
- [RFC 7493 — I-JSON](https://www.rfc-editor.org/rfc/rfc7493.html).
- [RFC 2104 — HMAC](https://www.rfc-editor.org/rfc/rfc2104.html).
- [FIPS PUB 180-4 — Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final).
