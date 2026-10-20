# Feature extraction: BE-FEAT-01A through BE-FEAT-01G

## What this milestone teaches

A feature extractor is an adapter between the event schema and a model schema.
Its job is not to make predictions. It turns one trusted normalized event into
the exact numeric contract that the model expects.

The processing order is:

1. authenticate and normalize a Collector batch;
2. extract deterministic features;
3. persist the enriched normalized events;
4. evaluate detection rules.

Doing feature extraction before persistence gives MongoDB and downstream
consumers the same representation. The extractor is pure: it performs no I/O,
does not read a clock, and does not mutate its input.

## Feature groups

| Group | Calculated in 01A | Deferred to 01B |
| --- | --- | --- |
| Time | UTC hour, Monday-based weekday, UTC business-hours flag | time since previous event, deviation |
| Identity text | Shannon character entropy for source IP, username, process name | historical uniqueness |
| Network volume | documented neutral defaults because the normalized contract has no byte fields yet | rolling volume context |
| Frequency/auth | documented neutral defaults | Redis-backed windows and history |
| Event | severity ID | none |

The output contains exactly the AI Engine's 20 numeric fields. Do not add or
reorder fields without versioning the model contract.

## Important implementation choices

- UTC methods (`getUTCHours`, `getUTCDay`) avoid different results on servers
  in different time zones.
- JavaScript uses Sunday as day zero, so `(getUTCDay() + 6) % 7` converts it to
  the model convention where Monday is zero.
- Missing strings produce entropy `0`; missing byte fields produce `0`, `0`,
  and ratio `1`.
- Every feature must be finite. `NaN` and infinity are rejected before the
  vector can cross a service boundary.
- `org_id` and `event_id` are validated and preserved, protecting tenant and
  event identity through the pipeline.

## Read before extending it

- Project `backend.md`: Feature Engineering Service and Feature Cache.
- Project `ai-engine.md`: the exact 20-feature model contract and defaults.
- MDN `Date`: understand UTC accessors versus host-local accessors.
- Shannon entropy: understand `-sum(p * log2(p))` and what it measures.
- For 01B, read Redis sorted sets and Lua/EVAL atomicity before implementing
  rolling windows.

## Extension exercise

Add a unit test for a Sunday event at 08:59 UTC, predict the three temporal
values before running it, and then implement a configurable organization time
zone without reading the host machine's local time zone.

## BE-FEAT-01B: Redis temporal and frequency history

01B replaces seven neutral defaults with event-time history:

| Feature | Redis representation |
| --- | --- |
| `time_since_last_event` | predecessor lookup in the source sorted set |
| `time_deviation_score` | source time-of-day running statistics |
| `events_per_minute_src_ip` | 60-second source-IP sorted-set count |
| `events_per_hour_user` | one-hour username sorted-set count |
| `unique_dst_ips_per_src` | 10-minute destination-IP sorted set |
| `unique_users_per_src_ip` | 10-minute username sorted set |
| `frequency_deviation` | current minute compared with the 24-hour source baseline |

### Why sorted sets?

A Redis sorted set stores a unique member and a numeric score. We use the
stable event ID as the member and the event timestamp as the score. That gives
us three important properties:

1. `ZADD NX` makes an exact event replay idempotent.
2. score-range queries implement event-time windows.
3. score-range deletion removes expired history.

The adapter executes the record, cleanup, count and snapshot-cache operations
inside one Lua script. Redis runs a script atomically, so concurrent BullMQ
workers never see a half-updated event.

### Replay and out-of-order policy

- A computed snapshot is cached by organization and event ID for seven days.
  An exact replay returns that original snapshot and does not increment state.
- Events in one batch are processed in timestamp order while the returned
  event array keeps its original order.
- A late event looks up the nearest predecessor at or before its own event
  timestamp, so `time_since_last_event` never becomes negative.
- Previously computed snapshots are not rewritten when a late event arrives.
  This keeps detection and retry results stable.

### Tenant isolation and privacy

Every key contains a SHA-256 digest of `org_id`, followed by digested source,
user or event identities. This prevents organizations from sharing windows and
avoids placing usernames or IP addresses directly in Redis key names.

### Failure policy

Redis is a disposable feature cache. If it times out or returns malformed
state, only that event falls back to the deterministic 01A defaults. MongoDB
persistence, rule detection and the BullMQ job continue normally.

Before changing the implementation, read the official Redis documentation for
sorted sets, `EVAL`, script atomicity and key expiry. Then read
`redis-temporal-frequency-feature.store.ts` beside its unit and integration
tests.

## BE-FEAT-01C: batch entropy and event volume

01C replaces four deterministic placeholders without changing the ordered
20-feature AI contract:

| Feature | Computation |
| --- | --- |
| `src_ip_entropy` | Shannon entropy of source-IP occurrences inside one organization and Collector batch |
| `bytes_sent` | first valid non-negative outbound byte value from explicit OCSF/preserved paths |
| `bytes_received` | first valid non-negative inbound byte value from explicit OCSF/preserved paths |
| `bytes_ratio` | sent / received; sent when received is zero; neutral `1` when both are zero |

### Why this is another decorator

The batch extractor wraps the Redis-backed extractor. Redis history and batch
statistics have different failure boundaries: a Redis outage must not erase
entropy or volume features that can be calculated entirely in memory. The
decorator also lets unit tests teach one concern at a time.

Entropy is grouped by both `org_id` and `ingestion.batch_id`. This prevents a
mixed caller input from leaking one tenant's distribution into another and
prevents unrelated batches from changing each other's score.

Only explicit byte paths are inspected (`traffic.bytes_out`,
`traffic.bytes_in`, their sent/received aliases, and preserved flat aliases).
The extractor does not recursively guess from arbitrary raw fields. Missing,
negative and non-numeric values receive the documented neutral defaults, and
every output remains finite.

### Read before changing 01C

- Review Shannon entropy as a categorical distribution:
  `H(X) = -sum(p(x) * log2(p(x)))`.
- Read the OCSF Network Activity/Traffic schema before adding a new byte alias.
- Read `batch-entropy-volume-feature-extractor.ts` together with its unit test.
- Remember that adding a 21st field is a model-version change; it is not part
  of this milestone.

## BE-FEAT-01D: Redis authentication behavior

01D replaces the last three neutral fields in the 20-feature model contract:

| Feature | Event-time calculation |
| --- | --- |
| `failed_login_count_10min` | failed attempts for the user in the preceding 10 minutes, including the current failure |
| `failed_to_success_ratio` | failed attempts divided by all attempts for the user in the preceding hour |
| `new_source_ip` | `1` when no successful login from this user/IP exists in the preceding seven days |

Only OCSF Authentication events (`class_uid = 3002`) with a trusted
`status_id` are recorded. Status `1` means success and status `2` means
failure. The normalizer now preserves this machine-readable outcome; feature
code never guesses from message text.

### Why failures do not teach a known IP

A failed attempt can come from an attacker. Adding every failed source to the
known-IP set would let the first attack attempt whitelist all later attempts.
Therefore the adapter checks every attempt but records an IP as known only
after a successful authentication.

### Redis representation

- one-hour user attempt sorted set;
- one-hour failed-attempt sorted set, queried with a ten-minute sub-window;
- seven-day successful source-IP occurrence sorted set;
- seven-day event snapshot for replay idempotency.

The keys contain SHA-256 digests of organization, user, source IP and event ID.
A Lua script updates all windows and creates the snapshot atomically. Events
inside a batch are submitted in event-time order, while the returned array
retains its original order. Redis failures affect only the current event and
fall back to `0`, `0`, `0`.

### Read before changing 01D

- OCSF Authentication Activity: learn `class_uid`, `status_id` and outcome
  semantics.
- Redis sorted-set score ranges: understand event-time windows.
- Redis Lua scripting: understand why the multi-key update is atomic.
- Read `redis-backed-authentication-feature-extractor.ts`, then the store and
  its unit/integration tests in that order.

## BE-FEAT-01E: process execution context

01E adds four backend process features for OCSF Process Activity events
(`class_uid = 1007`):

| Feature | Calculation |
| --- | --- |
| `process_rarity_score` | `1 - historical occurrences / historical process events` for the endpoint over 24 hours |
| `parent_child_anomaly` | `1` when the endpoint has not seen the parent/child pair in the preceding 24 hours |
| `process_path_depth` | Number of non-empty components in the executable path |
| `command_line_length` | Unicode code-point length of the command line |

The target process comes from the OCSF top-level `process` object. The parent
comes from `actor.process`, matching the Process Activity model where the actor
performs an action on the target process. Stateful history is isolated by
organization and endpoint; all identity-bearing Redis key components are
SHA-256 digests.

### First-seen semantics

Rarity is computed from history *before* inserting the current event. A process
with no previous occurrences therefore receives `1`, while a process that made
up all previous executions receives `0`. The same rule makes the first observed
parent/child pair anomalous and later observations familiar.

A seven-day per-event snapshot is checked before any history update. Replaying
an event therefore returns its original result and does not change the 24-hour
baseline. The record, calculation, expiry and snapshot are one Lua operation.

### Model-contract boundary

The deployed v1 AI model still accepts exactly the original 20 fields. Process
features are persisted as typed contextual fields for rules and investigation.
`selectAiFeatureVector()` explicitly copies only `AI_FEATURE_NAMES`, preventing
these extra fields from silently changing a model trained with shape `(N, 20)`.
A future 24-field model requires a new versioned model contract and retraining.

If Redis fails, deterministic path depth and command-line length remain
available; rarity and pair anomaly stay neutral. Ingestion continues.

### Read before changing 01E

- OCSF Process Activity: understand the difference between `actor.process`
  and the target `process`, and confirm `class_uid = 1007`.
- Redis `ZCOUNT`, sorted-set expiry and Lua atomicity.
- Read `redis-backed-process-feature-extractor.ts`, then
  `redis-process-feature.store.ts`, followed by the unit and integration tests.
- Never add process fields to the AI payload without retraining and versioning
  the model metadata, scaler and feature ordering.

## BE-FEAT-01F: network activity context

01F adds five contextual fields for OCSF Network Activity (`class_uid = 4001`)
and DNS Activity (`class_uid = 4003`) events:

| Feature | Calculation |
| --- | --- |
| `is_internal_to_external` | `1` only for an RFC1918 IPv4 source and a public IPv4 destination |
| `dst_port_rarity` | `1 - matching-port events / all port events` for the source over the preceding 24 hours |
| `connection_duration` | Non-negative OCSF `duration` in milliseconds, otherwise `0` |
| `dns_query_length` | Unicode code-point length of `query.hostname`, otherwise `0` |
| `is_known_bad_port` | `1` when the destination port is in the configured watch list |

Only Network Activity events with a source identity and valid destination port
update Redis. DNS Activity still receives deterministic DNS and network fields,
but does not distort the connection-port baseline.

### Why rarity is calculated before insertion

The current event must be compared with earlier behavior. The Lua script first
removes expired members, then uses `ZCOUNT` for the 24-hour total and selected
port, calculates rarity, and finally inserts the event. Thus the first port is
fully rare (`1`), an exclusively repeated port becomes familiar (`0`), and a
new port returns toward `1`.

The organization, source identity, and event ID are SHA-256 hashed in Redis
keys. A seven-day event snapshot makes replays return the original value without
adding a second observation. Calculation, insertion, expiry, and snapshotting
are atomic in one Lua script. A Redis error leaves rarity at the neutral `0`
while deterministic network fields and ingestion continue.

### Contract and ingestion boundaries

These five fields are persisted for rule evaluation and investigation.
`selectAiFeatureVector()` still copies only the original ordered 20 fields, so
the deployed model shape does not change. Adding network fields to the model
requires a separately trained and versioned model.

The current Collector event contract emits Authentication Activity. Seeing
network features in production therefore also requires a later Collector/OCSF
mapping that publishes Network Activity and DNS Activity fields. The extractor
is ready for those normalized events but does not invent missing telemetry.

### Read before changing 01F

- OCSF Network Activity and DNS Activity: confirm class IDs and field meaning.
- RFC 1918: understand that “private” here specifically means the three IPv4
  address blocks, not every non-public address.
- Redis sorted sets and `ZCOUNT`: understand score-bounded 24-hour windows.
- Redis Lua scripting: understand why replay check, counts, writes, and expiry
  are one atomic operation.
- Read `redis-backed-network-feature-extractor.ts`, then
  `redis-network-feature.store.ts`, followed by the unit and integration tests.

## BE-FEAT-01G: feature-plugin orchestration

01G replaces the production-only nesting of extractor decorators with the
plugin architecture described in `backend.md`. `PluginFeatureExtractor` first
runs one trusted base extractor, then runs registered plugins in their declared
order.

Each plugin declares:

- a unique, non-blank name;
- the OCSF class UIDs it understands, or an empty list for every class;
- an extraction operation that receives already-enriched events.

The production registry is now visible in one flat list:

1. `temporal-frequency` — all event classes;
2. `batch-entropy-volume` — all event classes;
3. `authentication` — Authentication Activity (`3002`);
4. `process` — Process Activity (`1007`);
5. `network` — Network Activity (`4001`) and DNS Activity (`4003`).

### Why the passthrough adapter exists

The 01A–01F extractors already contain tested logic and use the decorator
pattern. `PassthroughFeatureExtractor` lets each decorator receive an event that
the base extractor already enriched. `FeatureExtractorPluginAdapter` adds the
plugin name and class metadata. This is an incremental refactor: orchestration
changes without rewriting correct feature algorithms.

### Merge safety

After every plugin, the orchestrator verifies that:

- batch cardinality did not change;
- event ID, organization, OCSF class/category, event time, batch, and Collector
  identity did not change;
- no existing feature was removed;
- every resulting value is finite;
- two different plugins did not write different values to the same feature.

Non-applicable events never enter a class-specific plugin and retain their
position in the original batch. `pluginsExecuted` records only plugins that
actually received at least one event. Existing Redis fail-open behavior remains
inside the individual stateful plugins.

### How to add the next feature plugin yourself

1. Decide whether the feature is deterministic, batch-derived, or historical.
2. Define the numeric field and its missing-data default.
3. Implement and unit-test the extractor without the orchestrator.
4. Wrap it with `FeatureExtractorPluginAdapter` and declare its OCSF classes.
5. Register it once in the production composition root.
6. Add collision, tenant-boundary, replay, and failure-path tests as relevant.
7. Change `selectAiFeatureVector()` only when a newly trained model explicitly
   versions and orders the new field.

### Read before changing 01G

- Project `backend.md`, sections 8.1–8.3: orchestrator, aggregator, and plugin
  interface.
- Dependency inversion and the adapter pattern: understand why infrastructure
  plugins implement a domain-owned contract.
- `plugin-feature-extractor.ts`, then `feature-extractor-plugin.adapter.ts`,
  then `passthrough-feature-extractor.ts`.
- The 01G tests: each test represents an invariant that protects the pipeline.
