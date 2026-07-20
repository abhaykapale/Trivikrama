# Backend Design — Ingestion & Processing Pipeline

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | BACKEND-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-18 |
| **Status** | Draft |
| **Language** | Node.js + Express + TypeScript |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |
| **HLD Reference** | [HLD-001](file:///d:/AI%20SIEM/docs/HLD.md) |
| **SRS Reference** | [SRS-001](file:///d:/AI%20SIEM/docs/SRS.md) |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Watcher](#2-directory-watcher)
3. [Processing Queue](#3-processing-queue)
4. [Worker Design](#4-worker-design)
5. [Validation](#5-validation)
6. [Parsing](#6-parsing)
7. [Normalization](#7-normalization)
8. [Feature Extraction](#8-feature-extraction)

---

## 1. Overview

### 1.1 Pipeline Scope

This document covers the **ingestion and processing pipeline** — the data plane of the backend monolith. It handles the journey of every OCSF batch file from the collector directory to feature-ready events that enter the detection engines.

```mermaid
flowchart LR
    CDIR[("Collector<br/>Directory")]
    DW["Directory<br/>Watcher"]
    PQ{{"IProcessingQueue"}}
    WRK["Worker Pool"]
    VAL["Validator"]
    PAR["Parser"]
    NOR["Normalizer"]
    FEX["Feature<br/>Extractor"]
    OUT(("To Detection<br/>Rule Engine + AI"))

    CDIR -->|".json file event"| DW
    DW -->|"enqueue(job)"| PQ
    PQ -->|"dequeue()"| WRK
    WRK --> VAL
    VAL --> PAR
    PAR --> NOR
    NOR --> FEX
    FEX --> OUT

    style CDIR fill:#27ae60,color:#fff
    style PQ fill:#3498db,color:#fff
    style WRK fill:#8e44ad,color:#fff
    style OUT fill:#e74c3c,color:#fff
```

### 1.2 Design Principles

| Principle | Application in Pipeline |
|---|---|
| **Clean Architecture** | Each stage is an interface in the domain layer; implementations live in infrastructure |
| **Single Responsibility** | Watcher only watches. Queue only queues. Parser only parses. No stage does another stage's work |
| **Dependency Inversion** | Workers depend on `IValidator`, `IParser`, `INormalizer`, `IFeatureExtractor` — never on concrete classes |
| **Open/Closed** | New log formats are added by implementing `IFormatParser`; new features by implementing `IFeatureExtractorPlugin` |
| **Fail-Safe** | Every stage has a defined error path: quarantine, skip, log, or retry — never crash the worker |

### 1.3 Pipeline Component Diagram

```mermaid
graph TB
    subgraph PIPELINE["Backend - Ingestion and Processing Pipeline"]

        subgraph INGESTION["Ingestion Module"]
            DW["DirectoryWatcher<br/>(chokidar)"]
            IPQ{{"IProcessingQueue"}}
            BMQ["BullMQQueue<br/>(implements IProcessingQueue)"]
        end

        subgraph WORKERS["Worker Layer"]
            WP["WorkerManager<br/>(Concurrency controller)"]
            PW1["PipelineWorker 1"]
            PW2["PipelineWorker 2"]
            PW3["PipelineWorker N..."]
        end

        subgraph VALIDATION["Validation Stage"]
            IVAL{{"IValidator"}}
            FVAL["FileValidator<br/>(file integrity)"]
            SVAL["SchemaValidator<br/>(batch envelope)"]
        end

        subgraph PARSING["Parsing Stage"]
            IPAR{{"IParser"}}
            BPAR["BatchParser<br/>(extracts events from batch)"]
            IFMT{{"IFormatParser"}}
            FMT_JSON["JSONFormatParser"]
            FMT_SYSLOG["SyslogFormatParser"]
            FMT_CEF["CEFFormatParser"]
        end

        subgraph NORMALIZATION["Normalization Stage"]
            INOR{{"INormalizer"}}
            OCSF_NOR["OCSFNormalizer<br/>(schema validation + enrichment)"]
            OCSF_REG["OCSFSchemaRegistry<br/>(loaded OCSF JSON Schemas)"]
        end

        subgraph FEATURES["Feature Extraction Stage"]
            IFEX{{"IFeatureExtractor"}}
            FEX_CORE["CoreFeatureExtractor<br/>(orchestrator)"]
            IFEP{{"IFeaturePlugin"}}
            FEP_TIME["TemporalFeatures"]
            FEP_FREQ["FrequencyFeatures"]
            FEP_ENT["EntropyFeatures"]
            FEP_VOL["VolumeFeatures"]
            FEP_PROC["ProcessFeatures"]
        end
    end

    DW -->|"file event"| IPQ
    IPQ --> BMQ
    BMQ --> WP
    WP --> PW1
    WP --> PW2
    WP --> PW3

    PW1 --> IVAL
    IVAL --> FVAL
    IVAL --> SVAL
    SVAL --> IPAR
    IPAR --> BPAR
    BPAR --> IFMT
    IFMT --> FMT_JSON
    IFMT --> FMT_SYSLOG
    IFMT --> FMT_CEF
    BPAR --> INOR
    INOR --> OCSF_NOR
    OCSF_NOR --> OCSF_REG
    OCSF_NOR --> IFEX
    IFEX --> FEX_CORE
    FEX_CORE --> IFEP
    IFEP --> FEP_TIME
    IFEP --> FEP_FREQ
    IFEP --> FEP_ENT
    IFEP --> FEP_VOL
    IFEP --> FEP_PROC

    style IPQ fill:#3498db,color:#fff
    style IVAL fill:#3498db,color:#fff
    style IPAR fill:#3498db,color:#fff
    style INOR fill:#3498db,color:#fff
    style IFEX fill:#3498db,color:#fff
    style IFMT fill:#3498db,color:#fff
    style IFEP fill:#3498db,color:#fff
    style WP fill:#8e44ad,color:#fff
```

### 1.4 Interface Map

Every pipeline stage is defined by an interface in the domain layer. Concrete implementations live in the infrastructure layer.

| Interface | Layer | Implementation | Layer |
|---|---|---|---|
| `IDirectoryWatcher` | Domain | `ChokidarDirectoryWatcher` | Infrastructure |
| `IProcessingQueue` | Domain | `BullMQQueue` | Infrastructure |
| `IValidator` | Domain | `CompositeValidator` (FileValidator + SchemaValidator) | Infrastructure |
| `IParser` | Domain | `BatchParser` | Application |
| `IFormatParser` | Domain | `JSONFormatParser`, `SyslogFormatParser`, `CEFFormatParser` | Infrastructure |
| `INormalizer` | Domain | `OCSFNormalizer` | Application |
| `IFeatureExtractor` | Domain | `CoreFeatureExtractor` | Application |
| `IFeaturePlugin` | Domain | `TemporalFeatures`, `FrequencyFeatures`, `EntropyFeatures`, etc. | Infrastructure |

---

## 2. Directory Watcher

### 2.1 Component Diagram

```mermaid
graph TB
    subgraph DWC["DirectoryWatcher Component"]
        IDW{{"IDirectoryWatcher"}}

        subgraph IMPL["ChokidarDirectoryWatcher"]
            CHOK["chokidar.watch()<br/>Persistent file watcher"]
            FILTER["File Filter<br/>Only .json files<br/>Ignore .tmp, heartbeat.json"]
            DEDUP["Deduplication<br/>Ignore files already queued"]
            ENQUEUE["Enqueue Job<br/>IProcessingQueue.enqueue()"]
        end

        subgraph EVENTS["Watched Events"]
            E_ADD["add - new file detected"]
            E_CHANGE["change - file modified<br/>(ignored)"]
            E_UNLINK["unlink - file removed<br/>(ignored)"]
        end
    end

    CDIR[("Collector Directory")]
    IPQ_EXT{{"IProcessingQueue"}}
    LOG_EXT["Logger"]

    CDIR -->|"fs events"| CHOK
    CHOK --> E_ADD
    E_ADD --> FILTER
    FILTER --> DEDUP
    DEDUP --> ENQUEUE
    ENQUEUE --> IPQ_EXT

    FILTER -.->|"non-.json"| LOG_EXT
    DEDUP -.->|"already queued"| LOG_EXT

    style IDW fill:#3498db,color:#fff
    style IPQ_EXT fill:#3498db,color:#fff
```

### 2.2 Responsibilities

| Responsibility | Detail |
|---|---|
| **Watch directory** | Monitor the collector directory for new `.json` files using chokidar |
| **Filter files** | Only process files with `.json` extension; ignore `.tmp` files (in-progress collector writes) and `heartbeat.json` |
| **Deduplication** | Maintain an in-memory set of recently queued file paths to avoid re-queuing the same file |
| **Enqueue jobs** | Create a `QueueJob` descriptor and push it to `IProcessingQueue` |
| **Error handling** | Log and continue on any individual file error; never crash the watcher |

### 2.3 Watcher Configuration

| Setting | Default | Description |
|---|---|---|
| `watcher.directory` | `/var/siem/collector/` | Directory to watch |
| `watcher.poll_interval_ms` | `100` | Polling fallback interval (used when native FS events are unavailable) |
| `watcher.stable_threshold_ms` | `500` | Wait time after last file modification before considering the file "stable" (prevents reading mid-write) |
| `watcher.ignored_patterns` | `["*.tmp", "heartbeat.json"]` | Glob patterns to ignore |
| `watcher.dedup_ttl_seconds` | `300` | How long to remember queued file paths for deduplication |

### 2.4 File Stability Check

The collector writes atomically (`.tmp` to `.json` rename), so `.json` files are always complete. However, as a defense-in-depth measure, the watcher includes a stability check:

```mermaid
sequenceDiagram
    participant FS as File System
    participant CW as ChokidarWatcher
    participant STAB as StabilityCheck
    participant Q as IProcessingQueue

    FS->>CW: "add" event (batch_001.json)
    CW->>STAB: Check file stability
    STAB->>FS: stat(batch_001.json) - get mtime, size
    STAB->>STAB: Wait stable_threshold_ms (500ms)
    STAB->>FS: stat(batch_001.json) - get mtime, size again

    alt File is stable (mtime + size unchanged)
        STAB-->>CW: Stable
        CW->>CW: Filter (is .json? not ignored? not duplicate?)
        CW->>Q: enqueue({filePath, detectedAt, size})
    else File still changing
        STAB-->>CW: Unstable
        CW->>CW: Re-check on next poll
    end
```

### 2.5 QueueJob Descriptor

When the watcher enqueues a file, it creates a job descriptor:

| Field | Type | Description |
|---|---|---|
| `jobId` | `string` | Unique ID (UUID v4) |
| `filePath` | `string` | Absolute path to the batch file |
| `detectedAt` | `Date` | Timestamp when the file was detected |
| `fileSize` | `number` | File size in bytes (from `fs.stat`) |
| `retryCount` | `number` | Number of times this job has been retried (starts at 0) |
| `priority` | `number` | Job priority (default: 0; lower = higher priority) |

### 2.6 Interface Definition

```typescript
// Domain Layer - modules/ingestion/domain/IDirectoryWatcher.ts

interface IDirectoryWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFileDetected(callback: (job: QueueJob) => Promise<void>): void;
  getStats(): WatcherStats;
}

interface WatcherStats {
  isRunning: boolean;
  filesDetected: number;
  filesQueued: number;
  filesIgnored: number;
  lastFileDetectedAt: Date | null;
}
```

---

## 3. Processing Queue

### 3.1 Component Diagram

```mermaid
graph TB
    subgraph PQC["Processing Queue Component"]
        IPQ2{{"IProcessingQueue"}}

        subgraph CONTRACT["Interface Contract"]
            ENQ["enqueue(job): Promise&lt;string&gt;"]
            DEQ["process(handler): Promise&lt;void&gt;"]
            RET["retry(jobId): Promise&lt;void&gt;"]
            DLQ["deadLetter(jobId, reason): Promise&lt;void&gt;"]
            STAT["getStatus(): Promise&lt;QueueStatus&gt;"]
            PAU["pause(): Promise&lt;void&gt;"]
            RES["resume(): Promise&lt;void&gt;"]
        end

        subgraph BULLMQ_IMPL["BullMQQueue Implementation"]
            BQUEUE["BullMQ Queue<br/>(Redis-backed)"]
            BWORKER["BullMQ Worker<br/>(job processor)"]
            BEVENTS["Event Listeners<br/>completed, failed, stalled"]
            BDLQ["Dead Letter Queue<br/>(separate BullMQ queue)"]
        end
    end

    DW_EXT["DirectoryWatcher"] -->|"enqueue()"| IPQ2
    IPQ2 --> BQUEUE
    BQUEUE --> BWORKER
    BWORKER -->|"failed > maxRetries"| BDLQ
    BWORKER -->|"job"| WORK_EXT["WorkerManager"]

    RD_EXT[(Redis)]
    BQUEUE --> RD_EXT
    BDLQ --> RD_EXT

    style IPQ2 fill:#3498db,color:#fff
```

### 3.2 IProcessingQueue Interface

This is the **critical abstraction** mandated by ADR-001. No component outside the infrastructure layer ever touches BullMQ directly.

```typescript
// Domain Layer - modules/ingestion/domain/IProcessingQueue.ts

interface IProcessingQueue {
  /**
   * Add a job to the queue.
   * Returns the assigned job ID.
   */
  enqueue(job: QueueJob): Promise<string>;

  /**
   * Register a handler that processes jobs.
   * The queue implementation calls this handler for each dequeued job.
   * Concurrency is controlled by the implementation.
   */
  process(handler: JobHandler): Promise<void>;

  /**
   * Manually retry a specific failed job.
   */
  retry(jobId: string): Promise<void>;

  /**
   * Move a job to the dead letter queue with a reason.
   */
  deadLetter(jobId: string, reason: string): Promise<void>;

  /**
   * Get current queue status and metrics.
   */
  getStatus(): Promise<QueueStatus>;

  /**
   * Pause job processing (queue continues to accept jobs).
   */
  pause(): Promise<void>;

  /**
   * Resume processing after pause.
   */
  resume(): Promise<void>;

  /**
   * Graceful shutdown: stop processing, wait for active jobs to complete.
   */
  close(): Promise<void>;
}

type JobHandler = (job: QueueJob) => Promise<JobResult>;

interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  deadLettered: number;
  isPaused: boolean;
}

interface JobResult {
  success: boolean;
  eventsProcessed: number;
  errors: string[];
  duration_ms: number;
}
```

### 3.3 BullMQ Implementation Configuration

| Setting | Default | Description |
|---|---|---|
| `queue.name` | `"siem-pipeline"` | BullMQ queue name |
| `queue.concurrency` | `4` | Number of jobs processed in parallel |
| `queue.max_retries` | `3` | Max retry attempts before dead-letter |
| `queue.retry_backoff_ms` | `1000` | Initial retry backoff (exponential: 1s, 2s, 4s) |
| `queue.job_timeout_ms` | `60000` | Max time for a single job to complete |
| `queue.stall_interval_ms` | `30000` | How often to check for stalled jobs |
| `queue.remove_on_complete` | `true` | Remove successfully completed jobs from Redis |
| `queue.remove_on_fail` | `false` | Keep failed jobs for inspection |

### 3.4 Retry and Dead-Letter Flow

```mermaid
flowchart TD
    JOB["Job dequeued"]
    PROCESS["Worker processes job"]
    RESULT{"Success?"}
    COMPLETE["Mark completed<br/>Remove from queue"]
    FAIL["Job failed<br/>Error captured"]
    RETRY_CHECK{"retryCount<br/>< max_retries?"}
    RETRY["Re-enqueue<br/>Exponential backoff<br/>retryCount++"]
    DLQ["Move to Dead Letter Queue<br/>Store: jobId, error, attempts, timestamp"]
    ALERT["Log error<br/>Increment DLQ counter<br/>Surface in Collector Monitoring"]

    JOB --> PROCESS --> RESULT
    RESULT -->|"yes"| COMPLETE
    RESULT -->|"no"| FAIL
    FAIL --> RETRY_CHECK
    RETRY_CHECK -->|"yes"| RETRY
    RETRY_CHECK -->|"no"| DLQ
    RETRY --> JOB
    DLQ --> ALERT

    style COMPLETE fill:#27ae60,color:#fff
    style DLQ fill:#e74c3c,color:#fff
    style RETRY fill:#f39c12,color:#fff
```

### 3.5 Queue Swappability

Per ADR-001, the queue is behind `IProcessingQueue` so it can be replaced. Possible future implementations:

| Implementation | When to Use |
|---|---|
| `BullMQQueue` (current) | Production — Redis-backed, persistent, retry, DLQ |
| `InMemoryQueue` | Unit testing — no Redis dependency, synchronous processing |
| `KafkaQueue` (future) | If throughput exceeds Redis capacity (Phase 3) |

---

## 4. Worker Design

### 4.1 Component Diagram

```mermaid
graph TB
    subgraph WKD["Worker Design"]

        subgraph MANAGER["WorkerManager"]
            REG["Worker Registration"]
            CONC["Concurrency Control<br/>(1-16 configurable)"]
            HEALTH["Health Monitor<br/>(track active/stalled workers)"]
        end

        subgraph WORKER["PipelineWorker (per job)"]
            RECEIVE["Receive QueueJob<br/>{filePath, retryCount}"]
            READ["Read File<br/>fs.readFile(filePath)"]
            VALIDATE_S["Validate<br/>(IValidator)"]
            PARSE_S["Parse<br/>(IParser)"]
            NORMALIZE_S["Normalize<br/>(INormalizer)"]
            EXTRACT_S["Extract Features<br/>(IFeatureExtractor)"]
            HAND_OFF["Hand off to<br/>Detection Layer"]
            CLEANUP["Cleanup<br/>(move/delete processed file)"]
            REPORT["Report JobResult<br/>to queue"]
        end

        subgraph ERROR_HANDLING["Error Handling"]
            Q_FILE["Quarantine file<br/>(move to quarantine/)"]
            SKIP_EVENT["Skip bad event<br/>(log + continue)"]
            FAIL_JOB["Fail job<br/>(trigger retry)"]
        end
    end

    IPQ_W{{"IProcessingQueue"}} -->|"process(handler)"| REG
    REG --> CONC
    CONC --> WORKER

    RECEIVE --> READ --> VALIDATE_S
    VALIDATE_S -->|"valid"| PARSE_S
    VALIDATE_S -->|"invalid"| Q_FILE
    PARSE_S --> NORMALIZE_S
    NORMALIZE_S --> EXTRACT_S
    EXTRACT_S --> HAND_OFF
    HAND_OFF --> CLEANUP
    CLEANUP --> REPORT

    PARSE_S -->|"bad events"| SKIP_EVENT
    NORMALIZE_S -->|"schema violation"| SKIP_EVENT
    READ -->|"file not found"| FAIL_JOB

    style IPQ_W fill:#3498db,color:#fff
    style WORKER fill:#8e44ad,color:#fff
    style Q_FILE fill:#e74c3c,color:#fff
```

### 4.2 WorkerManager Responsibilities

| Responsibility | Detail |
|---|---|
| **Register with queue** | Calls `IProcessingQueue.process(handler)` with the pipeline handler function |
| **Concurrency control** | Configures BullMQ concurrency (1-16 workers via `WORKER_CONCURRENCY` env var) |
| **Health monitoring** | Tracks active workers, detects stalled workers, logs long-running jobs |
| **Graceful shutdown** | On `SIGTERM`: stops accepting new jobs, waits for active jobs to complete (with timeout), then exits |

### 4.3 PipelineWorker — Job Execution Flow

```mermaid
sequenceDiagram
    participant Q as IProcessingQueue
    participant WM as WorkerManager
    participant PW as PipelineWorker
    participant V as IValidator
    participant P as IParser
    participant N as INormalizer
    participant FX as IFeatureExtractor
    participant DET as Detection Layer
    participant FS as File System
    participant LOG as Logger

    Q->>WM: Job available
    WM->>PW: Execute job (filePath, retryCount)

    PW->>FS: readFile(filePath)
    FS-->>PW: Raw file content (Buffer)

    PW->>V: validate(fileContent, filePath)
    alt Validation fails
        V-->>PW: ValidationError
        PW->>FS: move file to quarantine/
        PW->>LOG: error("File validation failed", {filePath, error})
        PW-->>Q: JobResult {success: false}
    end
    V-->>PW: ValidatedBatch

    PW->>P: parse(validatedBatch)
    P-->>PW: ParseResult {events[], parseErrors[]}
    PW->>LOG: info("Parsed", {total, successful, failed})

    loop For each parsed event
        PW->>N: normalize(event)
        alt Normalization succeeds
            N-->>PW: NormalizedEvent (OCSF validated)
        else Schema violation
            N-->>PW: NormalizationError
            PW->>LOG: warn("Schema violation", {event, error})
        end
    end

    PW->>FX: extractFeatures(normalizedEvents[])
    FX-->>PW: FeatureEnrichedEvents[]

    PW->>DET: handOff(featureEnrichedEvents)

    PW->>FS: move filePath to processed/ or delete
    PW-->>Q: JobResult {success: true, eventsProcessed: N}
```

### 4.4 Worker Error Classification

| Error Type | Action | Retry? | Quarantine? |
|---|---|---|---|
| File not found | Fail job | Yes (file may appear) | No |
| File read permission denied | Fail job | Yes (permissions may be fixed) | No |
| Invalid JSON (corrupt file) | Quarantine file | No | Yes |
| Invalid batch envelope | Quarantine file | No | Yes |
| Individual event parse error | Skip event, continue | N/A (event-level, not job-level) | No |
| Individual schema violation | Flag event, continue | N/A | No |
| Feature extraction error | Skip features, pass event through | N/A | No |
| Unexpected exception | Fail job | Yes (transient) | No |

### 4.5 Worker Metrics

| Metric | Type | Description |
|---|---|---|
| `worker.jobs_processed` | Counter | Total jobs completed (success + failure) |
| `worker.jobs_succeeded` | Counter | Jobs that completed successfully |
| `worker.jobs_failed` | Counter | Jobs that exhausted retries |
| `worker.events_processed` | Counter | Total events processed across all jobs |
| `worker.events_skipped` | Counter | Events skipped due to parse/validation errors |
| `worker.job_duration_ms` | Histogram | Time to process a single job |
| `worker.active_count` | Gauge | Currently active workers |
| `worker.files_quarantined` | Counter | Files moved to quarantine directory |

### 4.6 File Lifecycle

```mermaid
flowchart LR
    A[("Collector Directory<br/>batch_001.json")]
    B["Worker picks up file"]
    C{"Processing<br/>outcome?"}
    D[("processed/<br/>batch_001.json")]
    E[("quarantine/<br/>batch_001.json")]
    F["Delete file<br/>(if configured)"]

    A --> B --> C
    C -->|"success + archive"| D
    C -->|"success + delete"| F
    C -->|"validation failure"| E

    style A fill:#27ae60,color:#fff
    style D fill:#3498db,color:#fff
    style E fill:#e74c3c,color:#fff
```

| Mode | Config Value | Behavior |
|---|---|---|
| **Archive** | `worker.processed_action: "archive"` | Move to `processed/` directory after success |
| **Delete** | `worker.processed_action: "delete"` | Delete file after success |
| **Quarantine** | Automatic | Move to `quarantine/` on validation failure (always) |

---

## 5. Validation

### 5.1 Component Diagram

```mermaid
graph TB
    subgraph VALC["Validation Component"]
        IVAL2{{"IValidator"}}

        subgraph COMPOSITE["CompositeValidator"]
            FV["FileValidator"]
            SV["SchemaValidator"]
        end

        subgraph FILE_CHECKS["FileValidator Checks"]
            FC1["File exists"]
            FC2["File size > 0"]
            FC3["File size < max_file_size"]
            FC4["File extension is .json"]
            FC5["File is readable"]
        end

        subgraph SCHEMA_CHECKS["SchemaValidator Checks"]
            SC1["Valid JSON syntax"]
            SC2["Has batch_id (string)"]
            SC3["Has collector_id (string)"]
            SC4["Has timestamp (ISO 8601)"]
            SC5["Has event_count (number >= 0)"]
            SC6["Has events (array)"]
            SC7["events.length == event_count"]
            SC8["Has schema_version (string)"]
        end
    end

    WORKER_V["PipelineWorker"] -->|"validate(content, path)"| IVAL2
    IVAL2 --> COMPOSITE
    COMPOSITE --> FV
    FV --> FC1 & FC2 & FC3 & FC4 & FC5
    COMPOSITE --> SV
    SV --> SC1 & SC2 & SC3 & SC4 & SC5 & SC6 & SC7 & SC8

    style IVAL2 fill:#3498db,color:#fff
```

### 5.2 Validation Interface

```typescript
// Domain Layer - modules/parsing/domain/IValidator.ts

interface IValidator {
  validate(content: Buffer, filePath: string): Promise<ValidationResult>;
}

interface ValidationResult {
  isValid: boolean;
  batch: ValidatedBatch | null;
  errors: ValidationError[];
}

interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  field?: string;
}

enum ValidationErrorCode {
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_EMPTY = "FILE_EMPTY",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  INVALID_EXTENSION = "INVALID_EXTENSION",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_JSON = "INVALID_JSON",
  MISSING_FIELD = "MISSING_FIELD",
  INVALID_FIELD_TYPE = "INVALID_FIELD_TYPE",
  EVENT_COUNT_MISMATCH = "EVENT_COUNT_MISMATCH",
  UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION",
}
```

### 5.3 Validation Pipeline

```mermaid
flowchart TD
    INPUT["Raw file content<br/>(Buffer)"]
    FVAL["FileValidator"]
    FC1{"File exists<br/>and readable?"}
    FC2{"0 < size < max?"}
    FC3{"Extension<br/>is .json?"}
    SVAL["SchemaValidator"]
    SC1{"Valid JSON<br/>syntax?"}
    SC2{"Required fields<br/>present?"}
    SC3{"event_count ==<br/>events.length?"}
    SC4{"Schema version<br/>supported?"}
    OUTPUT["ValidatedBatch"]
    REJECT["ValidationResult<br/>{isValid: false, errors[]}"]

    INPUT --> FVAL
    FVAL --> FC1
    FC1 -->|"no"| REJECT
    FC1 -->|"yes"| FC2
    FC2 -->|"no"| REJECT
    FC2 -->|"yes"| FC3
    FC3 -->|"no"| REJECT
    FC3 -->|"yes"| SVAL
    SVAL --> SC1
    SC1 -->|"no"| REJECT
    SC1 -->|"yes"| SC2
    SC2 -->|"no"| REJECT
    SC2 -->|"yes"| SC3
    SC3 -->|"no"| REJECT
    SC3 -->|"yes"| SC4
    SC4 -->|"no"| REJECT
    SC4 -->|"yes"| OUTPUT

    style OUTPUT fill:#27ae60,color:#fff
    style REJECT fill:#e74c3c,color:#fff
```

### 5.4 Validation Thresholds

| Check | Threshold | Rationale |
|---|---|---|
| Maximum file size | 50 MB | Prevents memory exhaustion on a single batch |
| Minimum file size | 1 byte | Empty files are invalid |
| Supported schema versions | `["1.0.0", "1.1.0"]` | Forward compatibility with collector upgrades |
| Maximum event count | 100,000 | Sanity limit per batch |

### 5.5 ValidatedBatch Type

After passing validation, the raw content is deserialized into a typed `ValidatedBatch`:

| Field | Type | Description |
|---|---|---|
| `batchId` | `string` | Unique batch identifier from collector |
| `collectorId` | `string` | Which collector produced this batch |
| `timestamp` | `Date` | When the batch was created |
| `eventCount` | `number` | Declared event count |
| `schemaVersion` | `string` | OCSF schema version |
| `events` | `RawOCSFEvent[]` | Array of unparsed OCSF event objects |

---

## 6. Parsing

### 6.1 Component Diagram

```mermaid
graph TB
    subgraph PARC["Parsing Component"]
        IPAR2{{"IParser"}}

        subgraph BATCH_PARSER["BatchParser"]
            ITER["Event Iterator<br/>Iterate over events[]"]
            DETECT["Format Detector<br/>Identify event format"]
            DISPATCH["Format Dispatcher<br/>Route to IFormatParser"]
            COLLECT["Result Collector<br/>Accumulate parsed events + errors"]
        end

        IFMT2{{"IFormatParser"}}

        subgraph FORMATS["Format Parser Implementations"]
            FP_JSON["JSONFormatParser<br/>Standard OCSF JSON"]
            FP_SYSLOG["SyslogFormatParser<br/>RFC 5424 remnants"]
            FP_CEF["CEFFormatParser<br/>ArcSight CEF"]
            FP_LEEF["LEEFFormatParser<br/>QRadar LEEF"]
        end
    end

    WORKER_P["PipelineWorker"] -->|"parse(validatedBatch)"| IPAR2
    IPAR2 --> BATCH_PARSER
    ITER --> DETECT --> DISPATCH
    DISPATCH --> IFMT2
    IFMT2 --> FP_JSON
    IFMT2 --> FP_SYSLOG
    IFMT2 --> FP_CEF
    IFMT2 --> FP_LEEF
    DISPATCH --> COLLECT

    style IPAR2 fill:#3498db,color:#fff
    style IFMT2 fill:#3498db,color:#fff
```

### 6.2 Parser Interface

```typescript
// Domain Layer - modules/parsing/domain/IParser.ts

interface IParser {
  parse(batch: ValidatedBatch): Promise<ParseResult>;
}

interface ParseResult {
  events: ParsedEvent[];
  errors: ParseError[];
  stats: ParseStats;
}

interface ParsedEvent {
  raw: RawOCSFEvent;          // Original event object
  parsed: Record<string, any>; // Extracted/typed fields
  sourceFormat: string;        // Detected format ("ocsf_json", "syslog", "cef")
  parseTimestamp: Date;        // When parsing occurred
}

interface ParseError {
  eventIndex: number;
  error: string;
  rawEvent: RawOCSFEvent;
}

interface ParseStats {
  totalEvents: number;
  successfullyParsed: number;
  failedToParse: number;
  formatBreakdown: Record<string, number>; // {"ocsf_json": 980, "syslog": 15, "cef": 5}
}
```

### 6.3 Format Parser Interface

```typescript
// Domain Layer - modules/parsing/domain/IFormatParser.ts

interface IFormatParser {
  /**
   * Returns true if this parser can handle the given event.
   */
  canParse(event: RawOCSFEvent): boolean;

  /**
   * Parse the event into structured fields.
   */
  parse(event: RawOCSFEvent): Promise<ParsedEvent>;

  /**
   * Returns the format name this parser handles.
   */
  formatName(): string;
}
```

### 6.4 Format Detection Logic

The collector already converts events to OCSF JSON, so the **primary format is always OCSF JSON**. However, the parser supports additional formats for forward compatibility and edge cases:

```mermaid
flowchart TD
    EVENT["Raw OCSF Event Object"]
    CHECK1{"Has class_uid<br/>and category_uid?"}
    CHECK2{"Has CEF: prefix<br/>in message?"}
    CHECK3{"Has LEEF: prefix<br/>in message?"}
    CHECK4{"Has PRI and<br/>RFC 5424 structure<br/>in message?"}

    FORMAT_JSON["JSONFormatParser<br/>(OCSF native)"]
    FORMAT_CEF["CEFFormatParser"]
    FORMAT_LEEF["LEEFFormatParser"]
    FORMAT_SYSLOG["SyslogFormatParser"]
    FORMAT_UNKNOWN["Unknown format<br/>Log warning, pass through"]

    EVENT --> CHECK1
    CHECK1 -->|"yes"| FORMAT_JSON
    CHECK1 -->|"no"| CHECK2
    CHECK2 -->|"yes"| FORMAT_CEF
    CHECK2 -->|"no"| CHECK3
    CHECK3 -->|"yes"| FORMAT_LEEF
    CHECK3 -->|"no"| CHECK4
    CHECK4 -->|"yes"| FORMAT_SYSLOG
    CHECK4 -->|"no"| FORMAT_UNKNOWN

    style FORMAT_JSON fill:#27ae60,color:#fff
    style FORMAT_UNKNOWN fill:#e67e22,color:#fff
```

> [!NOTE]
> In the MVP, **99%+ of events will be OCSF JSON** because the collector does the conversion. The CEF/LEEF/Syslog parsers exist for cases where the collector's `unmapped` field contains an embedded original log that needs additional parsing.

### 6.5 JSONFormatParser — Primary Parser

The primary parser validates and extracts typed fields from OCSF JSON events:

| Extraction | Source Field | Typed Output |
|---|---|---|
| Event class | `class_uid` | `OCSFEventClass` enum |
| Event category | `category_uid` | `OCSFCategory` enum |
| Severity | `severity_id` | `OCSFSeverity` enum (0-6) |
| Timestamp | `time` | `Date` (ISO 8601) |
| Source endpoint | `src_endpoint` | `Endpoint { ip, hostname, port, mac }` |
| Destination endpoint | `dst_endpoint` | `Endpoint { ip, hostname, port, mac }` |
| Actor | `actor` | `Actor { user, process, session }` |
| Device | `device` | `Device { hostname, ip, os, type }` |
| Message | `message` | `string` |
| Metadata | `metadata` | `Metadata { product, version, log_level }` |
| Unmapped | `unmapped` | `Record<string, any>` (preserved as-is) |

---

## 7. Normalization

### 7.1 Component Diagram

```mermaid
graph TB
    subgraph NORC["Normalization Component"]
        INOR2{{"INormalizer"}}

        subgraph OCSF_NORM["OCSFNormalizer"]
            SCHEMA_VAL["Schema Validation<br/>Validate against OCSF JSON Schema"]
            FIELD_ENRICH["Field Enrichment<br/>Derive missing fields from existing data"]
            TYPE_COERCE["Type Coercion<br/>Ensure correct data types"]
            UNMAPPED_HANDLE["Unmapped Handler<br/>Preserve unknown fields in unmapped{}"]
            DEDUP_CALC["Dedup ID Generator<br/>Hash for duplicate detection"]
        end

        subgraph SCHEMA_REG["OCSFSchemaRegistry"]
            SR_LOAD["Load OCSF JSON Schemas<br/>at startup"]
            SR_VALIDATE["Validate event against<br/>class-specific schema"]
            SR_VERSION["Version management<br/>(1.0.0, 1.1.0)"]
        end

        subgraph ENRICHERS["Enrichment Plugins"]
            EN_TIME["Timestamp Normalizer<br/>All times to UTC ISO 8601"]
            EN_GEO["GeoIP Enricher<br/>(optional - from local DB)"]
            EN_DNS["Reverse DNS<br/>(optional - cached)"]
            EN_ASSET["Asset Lookup<br/>(optional - from asset DB)"]
        end
    end

    WORKER_N["PipelineWorker"] -->|"normalize(parsedEvents)"| INOR2
    INOR2 --> OCSF_NORM
    OCSF_NORM --> SCHEMA_VAL
    SCHEMA_VAL --> SR_VALIDATE
    OCSF_NORM --> FIELD_ENRICH
    FIELD_ENRICH --> EN_TIME
    FIELD_ENRICH --> EN_GEO
    FIELD_ENRICH --> EN_DNS
    FIELD_ENRICH --> EN_ASSET
    OCSF_NORM --> TYPE_COERCE
    OCSF_NORM --> UNMAPPED_HANDLE
    OCSF_NORM --> DEDUP_CALC

    style INOR2 fill:#3498db,color:#fff
```

### 7.2 Normalizer Interface

```typescript
// Domain Layer - modules/parsing/domain/INormalizer.ts

interface INormalizer {
  normalize(events: ParsedEvent[]): Promise<NormalizationResult>;
}

interface NormalizationResult {
  events: NormalizedEvent[];
  errors: NormalizationError[];
  stats: NormalizationStats;
}

interface NormalizedEvent {
  id: string;                    // Unique event ID (UUID v4)
  dedupHash: string;             // SHA-256 hash for duplicate detection
  classUid: number;              // OCSF class UID
  categoryUid: number;           // OCSF category UID
  severityId: number;            // 0-6
  time: Date;                    // Normalized to UTC
  message: string;
  srcEndpoint: Endpoint | null;
  dstEndpoint: Endpoint | null;
  actor: Actor | null;
  device: Device | null;
  metadata: Metadata;
  unmapped: Record<string, any>;
  enrichments: Enrichments;      // Added by enrichment plugins
  schemaValid: boolean;          // Whether event passed OCSF schema validation
  validationErrors: string[];    // Schema validation errors (if any)
  rawEvent: Record<string, any>; // Original event (preserved for investigation)
}

interface NormalizationError {
  eventId: string;
  eventIndex: number;
  error: string;
  severity: "warning" | "error";
}

interface NormalizationStats {
  totalEvents: number;
  schemaValid: number;
  schemaInvalid: number;
  enriched: number;
  duplicatesDetected: number;
}
```

### 7.3 Normalization Pipeline

```mermaid
flowchart TD
    INPUT["ParsedEvent[]"]

    subgraph NORM_PIPELINE["Per-Event Normalization"]
        ASSIGN_ID["Assign Event ID<br/>(UUID v4)"]
        SCHEMA["Validate against<br/>OCSF JSON Schema"]
        SCHEMA_R{"Schema<br/>valid?"}
        FLAG["Flag as schemaValid=false<br/>Store validation errors<br/>Continue processing"]
        PASS["schemaValid=true"]

        COERCE["Type Coercion<br/>severity_id to number<br/>time to Date (UTC)<br/>port to number"]

        ENRICH["Enrichment Pipeline"]
        EN1["Timestamp normalization<br/>All to UTC ISO 8601"]
        EN2["GeoIP lookup<br/>IP to country/city/ASN"]
        EN3["Reverse DNS<br/>IP to hostname (cached)"]
        EN4["Asset lookup<br/>IP/hostname to asset_criticality"]

        UNMAPPED_H["Preserve unmapped fields<br/>in unmapped{} object"]

        DEDUP["Generate dedupHash<br/>SHA-256(class_uid + time + src_ip + dst_ip + message)"]
    end

    OUTPUT["NormalizedEvent[]"]

    INPUT --> ASSIGN_ID
    ASSIGN_ID --> SCHEMA
    SCHEMA --> SCHEMA_R
    SCHEMA_R -->|"no"| FLAG --> COERCE
    SCHEMA_R -->|"yes"| PASS --> COERCE
    COERCE --> ENRICH
    ENRICH --> EN1 --> EN2 --> EN3 --> EN4
    EN4 --> UNMAPPED_H --> DEDUP
    DEDUP --> OUTPUT

    style FLAG fill:#e67e22,color:#fff
    style OUTPUT fill:#27ae60,color:#fff
```

### 7.4 Schema Validation Detail

| Check | Rule | On Failure |
|---|---|---|
| `class_uid` | Must be a valid OCSF class UID (integer) | Flag event, continue |
| `category_uid` | Must be a valid OCSF category UID (integer) | Flag event, continue |
| `severity_id` | Integer 0-6 | Default to 1 (Informational) |
| `time` | Valid ISO 8601 timestamp | Use current timestamp, flag |
| `metadata.version` | Matches supported schema versions | Flag event, continue |
| Required fields per class | Class-specific required fields (e.g., Authentication requires `actor`) | Flag event, continue |

> [!IMPORTANT]
> Schema-invalid events are **never dropped**. They are flagged with `schemaValid: false` and continue through the pipeline. The analyst can see validation warnings in the investigation view. This prevents data loss while surfacing quality issues.

### 7.5 Deduplication Hash

The dedup hash is a SHA-256 computed from:

```
SHA-256(
  class_uid +
  category_uid +
  time (ISO 8601) +
  src_endpoint.ip +
  dst_endpoint.ip +
  message (first 256 chars)
)
```

This allows the backend to detect if the collector sent the same event twice (at-least-once delivery guarantee from collector). Deduplication is **detection only** in the normalization stage — the downstream Incident Correlator decides whether to drop or merge duplicates.

### 7.6 Enrichment Plugins

| Plugin | Input | Output | Source | MVP Status |
|---|---|---|---|---|
| **TimestampNormalizer** | Any timestamp format | UTC ISO 8601 `Date` | Built-in | ✅ MVP |
| **GeoIPEnricher** | IP address | `{country, city, latitude, longitude, asn}` | MaxMind GeoLite2 (local DB) | ✅ MVP |
| **ReverseDNS** | IP address | Hostname | DNS lookup (with Redis cache, 1hr TTL) | ⏳ Optional MVP |
| **AssetLookup** | IP / hostname | `{asset_name, criticality_score, owner}` | PostgreSQL asset table | ⏳ Optional MVP |

---

## 8. Feature Extraction

### 8.1 Component Diagram

```mermaid
graph TB
    subgraph FEXC["Feature Extraction Component"]
        IFEX2{{"IFeatureExtractor"}}

        subgraph CORE_FEX["CoreFeatureExtractor"]
            ORCH["Plugin Orchestrator<br/>Run all registered plugins"]
            AGG["Feature Aggregator<br/>Merge feature vectors"]
            CACHE["Feature Cache<br/>(Redis - recent stats)"]
        end

        IFEP2{{"IFeaturePlugin"}}

        subgraph PLUGINS["Feature Plugins"]
            P_TEMP["TemporalFeatures<br/>Time-based patterns"]
            P_FREQ["FrequencyFeatures<br/>Event rate patterns"]
            P_ENT["EntropyFeatures<br/>Randomness metrics"]
            P_VOL["VolumeFeatures<br/>Data transfer patterns"]
            P_PROC["ProcessFeatures<br/>Execution patterns"]
            P_AUTH["AuthenticationFeatures<br/>Login patterns"]
            P_NET["NetworkFeatures<br/>Connection patterns"]
        end
    end

    WORKER_F["PipelineWorker"] -->|"extractFeatures(normalizedEvents)"| IFEX2
    IFEX2 --> CORE_FEX
    ORCH --> IFEP2
    IFEP2 --> P_TEMP
    IFEP2 --> P_FREQ
    IFEP2 --> P_ENT
    IFEP2 --> P_VOL
    IFEP2 --> P_PROC
    IFEP2 --> P_AUTH
    IFEP2 --> P_NET
    ORCH --> AGG
    ORCH --> CACHE

    RD_EXT2[(Redis<br/>Feature Cache)]
    CACHE --> RD_EXT2

    style IFEX2 fill:#3498db,color:#fff
    style IFEP2 fill:#3498db,color:#fff
```

### 8.2 Feature Extractor Interface

```typescript
// Domain Layer - modules/analysis/domain/IFeatureExtractor.ts

interface IFeatureExtractor {
  extractFeatures(events: NormalizedEvent[]): Promise<FeatureExtractionResult>;
}

interface FeatureExtractionResult {
  events: FeatureEnrichedEvent[];
  stats: FeatureExtractionStats;
}

interface FeatureEnrichedEvent extends NormalizedEvent {
  features: FeatureVector;
}

interface FeatureVector {
  temporal: TemporalFeatureSet;
  frequency: FrequencyFeatureSet;
  entropy: EntropyFeatureSet;
  volume: VolumeFeatureSet;
  process: ProcessFeatureSet | null;
  authentication: AuthFeatureSet | null;
  network: NetworkFeatureSet | null;
}

interface FeatureExtractionStats {
  totalEvents: number;
  featuresExtracted: number;
  pluginsExecuted: string[];
  cacheMisses: number;
  cacheHits: number;
  duration_ms: number;
}
```

### 8.3 Feature Plugin Interface

```typescript
// Domain Layer - modules/analysis/domain/IFeaturePlugin.ts

interface IFeaturePlugin {
  /**
   * Unique name of this feature plugin.
   */
  name(): string;

  /**
   * Which OCSF event classes this plugin applies to.
   * Return empty array for "all classes".
   */
  applicableClasses(): number[];

  /**
   * Extract features from a batch of events.
   * Batch processing allows cross-event statistical features.
   */
  extract(events: NormalizedEvent[], cache: IFeatureCache): Promise<Map<string, PluginFeatureSet>>;
}

interface IFeatureCache {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttlSeconds: number): Promise<void>;
  increment(key: string): Promise<number>;
}
```

### 8.4 Feature Plugin Details

#### 8.4.1 Temporal Features

Detects anomalies based on **when** events occur.

| Feature | Computation | Why It Matters |
|---|---|---|
| `hour_of_day` | Extract hour (0-23) from event timestamp | Logins at 3 AM are suspicious |
| `day_of_week` | Extract day (0-6) from event timestamp | Weekend activity for office-hour assets |
| `is_business_hours` | Boolean: 9:00-17:00 local time, Mon-Fri | Off-hours activity flag |
| `time_since_last_event` | Seconds since previous event from same source | Burst detection |
| `time_deviation_score` | Z-score vs. historical mean event time for this entity | How unusual is this timing |

#### 8.4.2 Frequency Features

Detects anomalies based on **how often** events occur.

| Feature | Computation | Why It Matters |
|---|---|---|
| `events_per_minute_src_ip` | Count of events from source IP in last 60s (Redis counter) | Brute force / DoS detection |
| `events_per_hour_user` | Count of events for user in last 3600s | Account compromise |
| `unique_dst_ips_per_src` | Distinct destination IPs contacted by source in last 10min | Port scanning / lateral movement |
| `unique_users_per_src_ip` | Distinct usernames from same source IP in last 10min | Credential stuffing |
| `frequency_deviation` | Current rate vs. 24hr rolling average for this entity | Anomalous activity spikes |

#### 8.4.3 Entropy Features

Detects anomalies based on **randomness** in string fields.

| Feature | Computation | Why It Matters |
|---|---|---|
| `src_ip_entropy` | Shannon entropy of source IP distribution in batch | DGA detection (random IPs) |
| `username_entropy` | Shannon entropy of characters in username | Randomly generated usernames |
| `process_name_entropy` | Shannon entropy of process name characters | Obfuscated malware names |
| `url_entropy` | Shannon entropy of URL path characters | C2 beaconing with encoded URLs |

#### 8.4.4 Volume Features

Detects anomalies based on **data volumes**.

| Feature | Computation | Why It Matters |
|---|---|---|
| `bytes_sent` | Total bytes sent (from network events) | Data exfiltration |
| `bytes_received` | Total bytes received | Large payload downloads |
| `bytes_ratio` | sent / received ratio | Unusual transfer patterns |
| `volume_deviation` | Current volume vs. 24hr rolling average | Exfiltration spikes |

#### 8.4.5 Process Features

Detects anomalies in **process execution** (applies to process activity events only).

| Feature | Computation | Why It Matters |
|---|---|---|
| `process_rarity_score` | 1 - (occurrence_count / total_processes) over 24hr window | Rare processes are suspicious |
| `parent_child_anomaly` | Is this parent-child process pair seen before? (Boolean from Redis set) | `explorer.exe` spawning `powershell.exe` vs `cmd.exe` spawning `nc.exe` |
| `process_path_depth` | Depth of process path (`C:\a\b\c.exe` = 3) | Deep paths often malware |
| `command_line_length` | Character count of command line arguments | Extremely long command lines = obfuscation |

#### 8.4.6 Authentication Features

Detects anomalies in **login behavior** (applies to authentication events only).

| Feature | Computation | Why It Matters |
|---|---|---|
| `failed_login_count_10min` | Failed logins for this user in last 10 min (Redis counter) | Brute force detection |
| `failed_to_success_ratio` | Failed / total login attempts in last 1hr | Credential compromise |
| `geo_distance_km` | Distance between current login location and last known location (from GeoIP) | Impossible travel |
| `new_source_ip` | Has this user ever logged in from this IP? (Boolean from Redis set) | Account takeover from new location |
| `concurrent_sessions` | Active sessions for this user (Redis set size) | Session hijacking |

#### 8.4.7 Network Features

Detects anomalies in **network connections** (applies to network activity events only).

| Feature | Computation | Why It Matters |
|---|---|---|
| `is_internal_to_external` | Source is RFC1918, destination is public | Potential C2 / exfiltration |
| `dst_port_rarity` | How common is this destination port in last 24hr | Unusual port = suspicious service |
| `connection_duration` | Duration of network connection (if available) | Long-lived connections = tunneling |
| `dns_query_length` | Length of DNS query name | DNS tunneling detection |
| `is_known_bad_port` | Port in known-bad list (4444, 5555, etc.) | Common backdoor ports |

### 8.5 Feature Extraction Flow

```mermaid
flowchart TD
    INPUT2["NormalizedEvent[]<br/>(batch from normalizer)"]

    CLASS["Classify events by<br/>OCSF class_uid"]

    subgraph PARALLEL["Plugin Execution (per applicable class)"]
        TP["TemporalFeatures<br/>(all events)"]
        FP["FrequencyFeatures<br/>(all events)"]
        EP["EntropyFeatures<br/>(all events)"]
        VP["VolumeFeatures<br/>(network events)"]
        PP["ProcessFeatures<br/>(process events)"]
        AP["AuthFeatures<br/>(auth events)"]
        NP["NetworkFeatures<br/>(network events)"]
    end

    MERGE["Merge feature vectors<br/>into each event"]

    OUTPUT2["FeatureEnrichedEvent[]<br/>(ready for detection)"]

    INPUT2 --> CLASS
    CLASS --> TP
    CLASS --> FP
    CLASS --> EP
    CLASS --> VP
    CLASS --> PP
    CLASS --> AP
    CLASS --> NP
    TP --> MERGE
    FP --> MERGE
    EP --> MERGE
    VP --> MERGE
    PP --> MERGE
    AP --> MERGE
    NP --> MERGE
    MERGE --> OUTPUT2

    style INPUT2 fill:#3498db,color:#fff
    style OUTPUT2 fill:#27ae60,color:#fff
```

### 8.6 Feature Cache Strategy

Many features require historical context (e.g., "events per minute from this IP in the last 60 seconds"). The feature cache uses Redis to maintain rolling counters and sets:

| Cache Key Pattern | Data Type | TTL | Purpose |
|---|---|---|---|
| `feat:epm:{src_ip}` | Redis Counter | 60s | Events per minute by source IP |
| `feat:eph:{user}` | Redis Counter | 3600s | Events per hour by user |
| `feat:dst_ips:{src_ip}` | Redis Set | 600s | Unique destination IPs per source |
| `feat:users:{src_ip}` | Redis Set | 600s | Unique usernames per source IP |
| `feat:proc:{hostname}` | Redis Hash | 86400s | Process name occurrence counts |
| `feat:parent_child` | Redis Set | 86400s | Known parent-child process pairs |
| `feat:failed_login:{user}` | Redis Counter | 600s | Failed logins per user (10 min) |
| `feat:user_ips:{user}` | Redis Set | 604800s | Known IPs per user (7 days) |
| `feat:sessions:{user}` | Redis Set | 28800s | Active sessions per user (8hr) |
| `feat:avg:{entity}:{metric}` | Redis String (JSON) | 86400s | Rolling average for deviation calc |

> [!NOTE]
> **Redis is used as a feature cache, not a feature store.** If Redis is cleared, features gracefully degrade — deviation scores default to 0, rarity scores default to 0.5, and boolean features default to `false`. No pipeline failures.

### 8.7 Feature Vector Output Example

A fully feature-enriched event ready for the detection layer:

```json
{
  "id": "evt-abc123",
  "classUid": 3002,
  "categoryUid": 3,
  "severityId": 3,
  "time": "2026-07-18T03:15:22.000Z",
  "message": "Failed password for root from 192.168.1.100",
  "srcEndpoint": { "ip": "192.168.1.100" },
  "dstEndpoint": { "ip": "10.0.0.5" },
  "actor": { "user": { "name": "root" } },
  "schemaValid": true,
  "features": {
    "temporal": {
      "hour_of_day": 3,
      "day_of_week": 5,
      "is_business_hours": false,
      "time_since_last_event": 0.5,
      "time_deviation_score": 2.8
    },
    "frequency": {
      "events_per_minute_src_ip": 45,
      "events_per_hour_user": 120,
      "unique_dst_ips_per_src": 1,
      "unique_users_per_src_ip": 3,
      "frequency_deviation": 4.2
    },
    "entropy": {
      "src_ip_entropy": 0.0,
      "username_entropy": 1.58
    },
    "volume": null,
    "process": null,
    "authentication": {
      "failed_login_count_10min": 45,
      "failed_to_success_ratio": 0.98,
      "geo_distance_km": 0,
      "new_source_ip": true,
      "concurrent_sessions": 0
    },
    "network": null
  }
}
```

> This event shows clear brute force indicators: 45 failed logins in 10 minutes, 98% failure ratio, at 3 AM (off-hours), from a new source IP, with high frequency deviation. The Rule Engine and AI Engine will both flag this.

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). The processing pipeline runs entirely within the Node.js Express monolith. All stages are behind interfaces in the domain layer, with implementations in the infrastructure layer. No external message brokers, no distributed processing.**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-18
