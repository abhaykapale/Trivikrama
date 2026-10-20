# Trivikrama Collector

COL-01A established the C++20 build foundation, COL-01B added the frozen wire
contract, COL-01C added validated configuration, COL-01D added the first central
input reader and baseline OCSF mapping, COL-01E added the bounded and durable
publication pipeline, COL-01F added canonical HMAC signing and verification,
COL-01G added signed heartbeat publication and operational metrics, and COL-01H
composes those pieces into the running, recoverable Collector lifecycle.

## Scope delivered

- C++20 `collector` executable and reusable `collector_core` library target.
- CMake presets for developer, release, and sanitizer builds.
- Strict compiler warnings, optional warnings-as-errors, clang-tidy, ASan, and UBSan hooks.
- Manifest-mode vcpkg dependencies.
- Google Test contract harness and versioned compatibility fixtures.
- Frozen ARCH-01 v1.0.0 constants for batch, OCSF, security, capacity, and heartbeat limits.
- Typed event-batch, heartbeat, rejected-event, source, integrity, metric, and rejection models.
- Round-trip serializers that derive `event_count` instead of trusting mutable application state.
- Strict parsing that rejects BOMs, duplicate decoded keys, unsafe/non-finite numbers,
  excessive nesting, unknown envelope fields, invalid identifiers, and inconsistent payloads.
- Explicit unsigned-document output that removes only `integrity.value`.
- Strict YAML schema validation with duplicate and unknown field rejection.
- Immutable runtime configuration with documented environment overrides.
- Relative-path resolution anchored to the YAML file, plus writable-directory,
  directory-separation, and same-filesystem handoff/outbox checks.
- HMAC secret loading from an environment variable or protected, non-symlink file.
- Capacity checks tied to the frozen ARCH-01 event, batch, outbox, and heartbeat limits.
- A `--check-config` startup preflight that never prints the secret.
- A bounded, incremental JSON Lines `FileReader` for a central file-drop input.
- Cross-platform file identity, byte-offset positions, partial-line buffering, and
  replacement/truncation detection without loading the whole file into memory.
- Typed `RawEvent` preservation of sender, endpoint, upstream event identity,
  timestamps, raw payload, source position, and transport-security metadata.
- Baseline OCSF 1.1.0 mapping for simulated successful and failed authentication.
- Explicit typed rejections for malformed JSON, invalid UTF-8, oversized records,
  missing or mistyped fields, invalid timestamps/IP addresses, and unsupported events.
- Preservation of unknown input fields beneath `ocsf.unmapped`.
- A thread-safe FIFO queue bounded globally and per source by event count and bytes;
  reliable inputs receive explicit backpressure and no drop-oldest policy exists.
- A batch assembler that enforces event count, dwell time, and exact final signed
  encoded size, including the reserved 43-character signature.
- Durable 0600 writes, file fsync, atomic no-replace publication, and directory fsync
  on POSIX, with write-through publication on Windows.
- Identity-scoped durable outbox and handoff paths, immutable signed batch files,
  capacity refusal, recovery manifests, and deterministic restart replay.
- Backend-compatible publication under
  `COLLECTOR_DIR/incoming/<collector-id>/batch_<uuid-v4>.json`, with the signed
  heartbeat beside the batches as `heartbeat.json`.
- Atomic versioned checkpoints that merge source positions, reject file-offset
  regression, and advance only after a signed publication is visible.
- Durable signed rejection records with pending recovery and checkpoint advancement
  only after the rejection record is published.
- RFC 8785 canonical JSON with UTF-16 property ordering, minimal string escaping,
  and ECMAScript-compatible shortest number formatting.
- HMAC-SHA256 signing for batches, heartbeats, and rejected events over the exact
  domain-separated unsigned document.
- Unpadded base64url signatures, constant-time verification, decoded-secret memory
  cleansing, and a cross-language signing vector independently generated with Node.js.
- Thread-safe saturating event counters plus queue, outbox, last-batch, CPU, memory,
  and available-disk metrics using bounded contract-safe values.
- Explicit active degradation signals for source failures, reliable backpressure,
  best-effort loss, publication failures, and metric saturation.
- Signed collector-scoped `heartbeat.json` publication using durable temporary writes
  and atomic replacement every 30 seconds.
- Durable heartbeat sequence reservation across restarts, preventing sequence reuse
  even when a publication attempt fails.
- Derived `online`, `degraded`, and graceful `shutting_down` status; `offline` remains
  backend-derived after two missed heartbeat intervals.
- Runtime composition from configured file readers through mapping, bounded queueing,
  time/count/size batching, signing, durable handoff, checkpoints, metrics, and heartbeats.
- Startup recovery of sealed batches and pending rejection records before source polling.
- Exact file-identity/offset resume from committed checkpoints, with safe restart from the
  beginning when a file was replaced or truncated.
- Retry-safe batch and rejection publication: a checkpoint failure retries the same signed
  identifier instead of creating a second publication or advancing the source.
- SIGINT/SIGTERM handling that stops new polling, drains accepted work, publishes the final
  batch/checkpoint, and emits a signed `shutting_down` heartbeat.
- End-to-end and fault-injection coverage for signed handoff, ordered rejection publication,
  checkpoint restart, checkpoint-write failure, and outbox-capacity exhaustion.

## Prerequisites on Windows

- Visual Studio 2022 Build Tools with the Desktop development with C++ workload.
- CMake 3.25 or newer.
- Ninja.
- vcpkg, with `VCPKG_ROOT` pointing to its installation directory.

## Configure, build, and test

Run these commands from `D:\Trivikrama\collector` in PowerShell:

```powershell
cmake --preset dev
cmake --build --preset dev
ctest --preset dev
```

Inspect the executable version:

```powershell
.\out\build\dev\collector.exe --version
```

Validate the supplied development configuration without starting ingestion:

```powershell
$env:COLLECTOR_HMAC_SECRET = "<64 unpadded base64url characters>"
.\out\build\dev\collector.exe --check-config .\config\collector.yaml
```

Run the Collector in the foreground and stop it gracefully with `Ctrl+C`:

```powershell
$env:COLLECTOR_HMAC_SECRET = "<64 unpadded base64url characters>"
.\out\build\dev\collector.exe --config .\config\collector.yaml
```

With no arguments, the executable uses `config/collector.yaml` relative to the current
working directory.

For a release validation:

```powershell
cmake --preset release
cmake --build --preset release
ctest --preset release
```

## Contract rule locked by the harness

The signed document retains `integrity.algorithm` and `integrity.key_id` but omits only
`integrity.value`. The remaining document is canonicalized using RFC 8785. The signing input is:

```text
UTF8("TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n") || RFC8785(unsigned_document)
```

The HMAC is SHA-256 and its transmitted value is unpadded base64url. `ContractSigner`
implements this rule for event batches, heartbeats, and rejected events. Ordinary JSON
serialization is never used as the cryptographic input.

Contract-owned objects reject unknown fields. The OCSF payload and adapter-specific
`source.position` remain opaque JSON at this layer; field-level validation belongs to the OCSF
mapper and the selected ingress adapter.

## Configuration contract

The YAML file is the baseline. After it passes schema and path validation, these
documented environment variables override it, and the resulting configuration is
validated again:

| Variable | Target | Constraint |
|---|---|---|
| `COLLECTOR_ID` | `collector.id` | 1–64 lowercase characters from `[a-z0-9._-]` |
| `COLLECTOR_LOG_LEVEL` | `collector.log_level` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, or `CRITICAL` |
| `COLLECTOR_OUTPUT_DIR` | `output.directory` | Existing directory writable by the process |
| `COLLECTOR_BATCH_SIZE` | `scheduler.batch_size` | 1–1000 events |
| `COLLECTOR_BATCH_TIMEOUT` | `scheduler.batch_timeout_seconds` | 1–5 seconds |

`COLLECTOR_HMAC_SECRET` supplies exactly 64 unpadded base64url characters.
Alternatively, `COLLECTOR_HMAC_SECRET_FILE` names a protected secret file; on POSIX,
group and other permissions are rejected. The two variables are mutually exclusive.
The optional YAML `security.hmac_secret_file` is a file-only fallback—inline YAML
secrets are deliberately unsupported.

The output handoff, state, outbox, and rejected directories must already exist and
must be distinct. Handoff and outbox must be on the same filesystem so the later
publisher can use atomic rename. State remains separate from the backend-owned
handoff boundary. YAML-relative paths are resolved relative to the configuration
file; environment-relative paths are resolved from the process working directory.

COL-01C accepts only an enabled `file_drop` central ingress source. Syslog, Windows
Event Forwarding, and HTTP are recognized but cannot be enabled until their secured,
transport-specific adapters are implemented in later milestones.

## Simulated input and baseline mapping

The shipped [`samples/simulated-auth.jsonl`](samples/simulated-auth.jsonl) file represents
events already delivered to the central Collector by an existing forwarding mechanism.
Each completed line is a versionless simulation record with these required string fields:

| Input field | Preserved or mapped as |
|---|---|
| `event_id` | Upstream identity and part of stable contract `event_id` |
| `endpoint_id` | Original endpoint identity and `device.hostname` |
| `event_type` | Authentication activity/status (`login_success` or `login_failed`) |
| `timestamp` | Original event time and OCSF epoch-millisecond `time` |
| `username` | `user.name` |
| `source_ip` | `src_endpoint.ip` after IPv4/IPv6 validation |

An optional nonempty `message` overrides the baseline message. Every other source field
is retained under `ocsf.unmapped`; it is not discarded or interpreted as enrichment.
The mapper emits Authentication class `3002`, Identity and Access Management category
`3`, and the corresponding success/failure activity, type, status, and severity values.

The reader tracks an in-memory read position independently from the committed durable
checkpoint. On startup, the runtime resumes at the checkpoint offset only when the file
identity still matches; replacement, rotation, truncation, or overwrite resets the reader
to the beginning of the new content. It does not emit a partial final line. Records are bounded
by the frozen 512 KiB event limit; work per poll and rejection captures are separately
bounded so a malformed source cannot force unbounded memory use or monopolize a poll.

## Durable publication and recovery

`BoundedEventQueue` applies backpressure at both global and per-source limits. The
`BatchAssembler` uses final signed wire size rather than a rough memory estimate, so
adding the signature cannot push an accepted batch past 8 MiB.

`OutboxPublisher` accepts only contract-valid, already-signed batches. It writes and
fsyncs a sealed outbox copy and recovery manifest, copies the complete bytes to a
handoff temporary file, then makes the final file atomically visible. Only after that
publication succeeds does `CheckpointStore` advance source positions. A checkpoint
failure leaves the sealed copy in place; restart recovery republishes the same stable
batch ID, relying on backend idempotency rather than risking loss.

For the sibling development layout used by this repository, configure the backend with
`COLLECTOR_DIR=../collector/runtime/handoff`. Final batches and the heartbeat then share
the frozen identity-scoped intake directory:

```text
runtime/handoff/
├── incoming/<collector-id>/batch_<uuid-v4>.json
├── incoming/<collector-id>/heartbeat.json
├── processing/
├── processed/
└── quarantine/
```

The Collector owns atomic publication into `incoming`; the backend owns claiming and
all transitions through `processing`, `processed`, and `quarantine`.

Rejected inputs follow the same rule through `RejectedEventPublisher`: the signed
rejection remains pending until its immutable audit record is visible and its source
position has committed. Checkpoints record whether their last durable publication was
an event batch or a rejected event.

`ContractSigner` now supplies the real RFC 8785 and HMAC-SHA256 step before those
publishers are called. The shared fixture records the unsigned document, canonical bytes,
domain prefix, 48-byte test secret, raw HMAC digest, and transmitted signature so the C++
Collector and TypeScript backend can enforce the same byte-level contract.

## Heartbeats and operational metrics

`OperationalMetrics` records cumulative received, published, rejected, and explicitly
lost best-effort events. Queue and outbox depths are gauges rather than cumulative
counters. Counter increments saturate at the contract's safe JSON integer limit instead
of wrapping, and saturation marks the Collector degraded.

`SystemResourceProbe` samples process CPU and resident memory plus available space on the
handoff filesystem. `HeartbeatPublisher` combines those resource values with pipeline
metrics, derives status, signs the frozen heartbeat envelope, and atomically replaces only
`<handoff>/<collector-id>/heartbeat.json`. A separate collector-owned sequence file is
fsynced before publication, so crashes can create a harmless sequence gap but cannot reuse
an already reserved value.

`CollectorRuntime` calls `publish_if_due()` from its monotonic scheduler loop. On shutdown,
it stops accepting poll cycles, retries any in-flight durable publication, drains buffered
records and the queue in source order, flushes the final signed batch and checkpoint, and
only then publishes the final signed `shutting_down` heartbeat.

## Runtime reliability validation

The COL-01H harness exercises the complete Collector-side path from simulated JSON Lines
through a verified signed batch, committed checkpoint, metrics, and shutdown heartbeat. It
also injects checkpoint-write and outbox-capacity failures, verifies that checkpoints do not
advance, and proves that retry uses the same sealed batch. Backend watcher/worker/database
tests remain in the backend suite because the approved architecture keeps the filesystem
handoff as the process boundary.
