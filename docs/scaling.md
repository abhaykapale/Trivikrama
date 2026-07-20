# Scalability Strategy

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | SCALE-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-19 |
| **Status** | Draft |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |
| **Database Reference** | [DB-001](file:///d:/AI%20SIEM/docs/database.md) |
| **Backend Reference** | [BACKEND-001](file:///d:/AI%20SIEM/docs/backend.md) |

---

## Table of Contents

1. [Scaling Tiers](#1-scaling-tiers)
2. [Caching](#2-caching)
3. [Database Scaling](#3-database-scaling)
4. [Worker Scaling](#4-worker-scaling)
5. [Queue Scaling](#5-queue-scaling)
6. [Collector Scaling](#6-collector-scaling)

---

## 1. Scaling Tiers

The platform is designed as a **Modular Monolith** (ADR-001). Scaling follows a progressive strategy — each tier introduces incremental changes without rewriting the architecture.

### 1.1 Scaling Roadmap

```mermaid
graph LR
    T1["Tier 1<br/>100 Users<br/>Single Machine"]
    T2["Tier 2<br/>1,000 Users<br/>Vertical + Tuning"]
    T3["Tier 3<br/>10,000 Users<br/>Horizontal Split"]
    T4["Tier 4<br/>100,000 Users<br/>Distributed"]

    T1 -->|"vertical scale<br/>+ cache"| T2
    T2 -->|"separate DB hosts<br/>+ multiple workers"| T3
    T3 -->|"distributed infra<br/>+ read replicas"| T4

    style T1 fill:#27ae60,color:#fff
    style T2 fill:#3498db,color:#fff
    style T3 fill:#f39c12,color:#fff
    style T4 fill:#e74c3c,color:#fff
```

---

### 1.2 Tier 1 — 100 Users (MVP)

**Profile:** Small SOC team, single organization, ~500 EPS (events per second).

```mermaid
graph TB
    subgraph SINGLE["Single Machine (16 GB RAM, 8 cores)"]
        COL["Collector Agent<br/>(1 instance, C++)"]
        BE["Backend<br/>(1 Node.js process)"]
        AI["AI Engine<br/>(1 FastAPI process)"]
        FE["Frontend<br/>(1 Next.js process)"]
        PG["PostgreSQL<br/>(local)"]
        MDB["MongoDB<br/>(local)"]
        RD["Redis<br/>(local)"]
    end

    style SINGLE fill:#1a1a2e,color:#fff
```

| Component | Configuration | Capacity |
|---|---|---|
| **Backend** | 1 Node.js process, 4 BullMQ workers | ~500 EPS ingestion |
| **AI Engine** | 1 FastAPI process, 1 uvicorn worker | ~200 inferences/sec |
| **PostgreSQL** | Single instance, 4 GB RAM, no replication | ~5M incidents, ~50M alerts |
| **MongoDB** | Single instance, 4 GB RAM, WiredTiger | ~500M events (90-day retention) |
| **Redis** | Single instance, 512 MB | Queue + cache + rate limits |
| **Collector** | 1 instance, 4 log sources | ~500 EPS combined |
| **Disk** | 500 GB SSD | ~6 months of data |

**Bottleneck:** CPU-bound on a single Node.js process at ~500 EPS.

**Scaling levers at this tier:**
- Tune `pm2` cluster mode for Node.js (see Tier 2)
- Enable Redis caching for dashboard queries
- Configure MongoDB indexes properly

---

### 1.3 Tier 2 — 1,000 Users (Growth)

**Profile:** Medium SOC, ~2,000 EPS, multiple Collectors across sites.

```mermaid
graph TB
    subgraph HOST["Single Machine (64 GB RAM, 16 cores)"]

        subgraph APP["Application Layer"]
            BE1["Backend (PM2 cluster)<br/>4 Node.js processes"]
            AI2["AI Engine<br/>2 uvicorn workers"]
            FE2["Frontend (Next.js)<br/>2 processes"]
        end

        subgraph DATA["Data Layer"]
            PG2["PostgreSQL<br/>16 GB RAM<br/>connection pooling (PgBouncer)"]
            MDB2["MongoDB<br/>8 GB RAM<br/>WiredTiger cache: 4 GB"]
            RD2["Redis<br/>2 GB RAM<br/>maxmemory-policy: allkeys-lru"]
        end
    end

    subgraph COLLECTORS["Remote Collectors"]
        COL_A["Collector A<br/>(Site 1)"]
        COL_B["Collector B<br/>(Site 2)"]
        COL_C["Collector C<br/>(Site 3)"]
    end

    COL_A -->|"NFS / rsync"| HOST
    COL_B -->|"NFS / rsync"| HOST
    COL_C -->|"NFS / rsync"| HOST

    style HOST fill:#1a1a2e,color:#fff
```

**Changes from Tier 1:**

| Change | Description | Impact |
|---|---|---|
| **PM2 cluster mode** | 4 Node.js worker processes behind PM2 | 4× request throughput |
| **PgBouncer** | Connection pooler in front of PostgreSQL | Handle 1000+ concurrent connections with 50 actual DB connections |
| **Redis caching** | Dashboard summary cached for 30s, rule cache, session cache | 90% reduction in dashboard DB queries |
| **MongoDB WiredTiger tuning** | `cacheSizeGB: 4`, dedicated SSD for data directory | 4× read throughput |
| **uvicorn workers** | 2 AI Engine workers behind uvicorn | 2× inference throughput |
| **Multiple Collectors** | 3 Collectors across sites, writing to shared NFS or syncing via rsync | Geographic log collection |
| **Increased retention** | PostgreSQL partitioning active, MongoDB TTL indexes | Automated cleanup |

| Component | Configuration | Capacity |
|---|---|---|
| **Backend** | PM2 cluster × 4, 8 BullMQ workers (2 per process) | ~2,000 EPS |
| **AI Engine** | 2 uvicorn workers | ~400 inferences/sec |
| **PostgreSQL** | PgBouncer, 16 GB RAM, monthly partitions | ~20M incidents |
| **MongoDB** | 8 GB WiredTiger cache, dedicated SSD | ~2B events (90 days) |
| **Redis** | 2 GB, LRU eviction | Queue + cache + 1000 sessions |

**Bottleneck:** Single PostgreSQL and single MongoDB at ~2,000 EPS.

---

### 1.4 Tier 3 — 10,000 Users (Enterprise)

**Profile:** Large SOC, ~10,000 EPS, 10+ Collectors, requires high availability.

```mermaid
graph TB
    subgraph LB_LAYER["Load Balancer"]
        NGINX["Nginx<br/>(round-robin)"]
    end

    subgraph APP_HOSTS["Application Hosts (×2)"]
        subgraph HOST_A["Host A"]
            BE_A["Backend PM2 ×4"]
            FE_A["Frontend ×2"]
        end
        subgraph HOST_B["Host B"]
            BE_B["Backend PM2 ×4"]
            FE_B["Frontend ×2"]
        end
    end

    subgraph AI_HOST["AI Host"]
        AI_3["AI Engine<br/>4 uvicorn workers<br/>GPU optional"]
    end

    subgraph DB_HOSTS["Database Hosts"]
        subgraph PG_HOST["PostgreSQL Host (128 GB RAM)"]
            PG_PRIMARY["Primary<br/>(read/write)"]
            PG_REPLICA["Read Replica<br/>(read-only)"]
        end
        subgraph MDB_HOST["MongoDB Host (128 GB RAM)"]
            MDB_PRIMARY["Primary"]
            MDB_SECONDARY["Secondary<br/>(read preference)"]
        end
        RD_3["Redis (dedicated host)<br/>Sentinel for HA"]
    end

    subgraph COLLECTORS_3["Collectors (×10+)"]
        COL_FARM["Collector 1..10<br/>(distributed across sites)"]
    end

    NGINX --> HOST_A
    NGINX --> HOST_B
    HOST_A --> AI_3
    HOST_B --> AI_3
    HOST_A --> PG_PRIMARY
    HOST_A --> PG_REPLICA
    HOST_B --> PG_PRIMARY
    HOST_B --> PG_REPLICA
    HOST_A --> MDB_PRIMARY
    HOST_A --> MDB_SECONDARY
    HOST_B --> MDB_PRIMARY
    HOST_B --> MDB_SECONDARY
    HOST_A --> RD_3
    HOST_B --> RD_3
    COL_FARM --> HOST_A
    COL_FARM --> HOST_B

    style DB_HOSTS fill:#1a1a2e,color:#fff
    style APP_HOSTS fill:#2c3e50,color:#fff
```

**Changes from Tier 2:**

| Change | Description | Impact |
|---|---|---|
| **Separate hosts** | Application, AI, and Database on dedicated machines | Resource isolation, independent scaling |
| **Load balancer** | Nginx round-robin across 2 app hosts | 2× app throughput, no single point of failure |
| **PostgreSQL read replica** | Dashboard reads and event search go to replica | 60% reduction in primary load |
| **MongoDB replica set** | Secondary for read-heavy operations (investigation, search) | Read scalability, data redundancy |
| **Redis Sentinel** | Automated failover for Redis | High availability for queues and cache |
| **AI Engine dedicated host** | 4 uvicorn workers, optional GPU for SHAP | Compute isolation, ~800 inferences/sec |
| **10+ Collectors** | Distributed across network segments and sites | Full network coverage |

| Component | Configuration | Capacity |
|---|---|---|
| **Backend** | 2 hosts × PM2 ×4 = 8 Node.js processes, 16 workers | ~10,000 EPS |
| **AI Engine** | Dedicated host, 4 workers | ~800 inferences/sec |
| **PostgreSQL** | Primary + 1 replica, 128 GB RAM | ~100M incidents |
| **MongoDB** | Primary + 1 secondary, 128 GB RAM | ~10B events |
| **Redis** | Dedicated host, Sentinel, 8 GB | Full cache + queue HA |

**Bottleneck:** Single PostgreSQL primary for writes. MongoDB write throughput at ~10K EPS.

---

### 1.5 Tier 4 — 100,000 Users (Massive Scale)

**Profile:** Enterprise/MSSP, ~100,000 EPS, 50+ Collectors, multi-region.

> [!IMPORTANT]
> Tier 4 exceeds the Modular Monolith boundary defined in ADR-001. Reaching this tier requires a partial architectural transition — extracting the ingestion pipeline into a dedicated service and introducing message brokers. This is a planned evolution, not an MVP concern.

```mermaid
graph TB
    subgraph LB["Global Load Balancer"]
        GLB["HAProxy / Cloud LB"]
    end

    subgraph REGION_A["Region A"]
        subgraph APP_A["App Cluster (×4 hosts)"]
            BE_4A["Backend PM2 ×4<br/>(per host)"]
        end
        subgraph AI_A["AI Cluster (×2 hosts)"]
            AI_4A["AI Engine ×4 workers<br/>(per host, GPU)"]
        end
        subgraph INGEST_A["Ingestion Service"]
            KAFKA_A["Apache Kafka<br/>(message broker)"]
            INGEST_W["Ingestion Workers<br/>(×8)"]
        end
    end

    subgraph DB_CLUSTER["Database Cluster"]
        PG_CLUSTER["PostgreSQL<br/>Primary + 2 Replicas<br/>+ PgBouncer pool"]
        MDB_CLUSTER["MongoDB<br/>Sharded Cluster<br/>(3 shards × 3 replicas)"]
        RD_CLUSTER["Redis Cluster<br/>(6 nodes, 3 masters)"]
    end

    subgraph COL_FLEET["Collector Fleet (50+)"]
        COL_FLEET_N["Collectors<br/>across all sites<br/>and regions"]
    end

    GLB --> APP_A
    COL_FLEET_N --> KAFKA_A
    KAFKA_A --> INGEST_W
    INGEST_W --> MDB_CLUSTER
    APP_A --> PG_CLUSTER
    APP_A --> MDB_CLUSTER
    APP_A --> RD_CLUSTER
    APP_A --> AI_A

    style REGION_A fill:#1a1a2e,color:#fff
    style DB_CLUSTER fill:#2c3e50,color:#fff
```

**Changes from Tier 3:**

| Change | Description | Impact |
|---|---|---|
| **Kafka ingestion** | Filesystem watcher replaced with Kafka for log transport | Decoupled ingestion, replay capability, 100K+ EPS |
| **MongoDB sharding** | Shard by `time` field (range-based) | Horizontal write scaling |
| **PostgreSQL read replicas ×2** | Multiple replicas for different read patterns | Dashboard + search + export isolated |
| **Redis Cluster** | 3 masters, 3 replicas | Queue/cache HA + horizontal throughput |
| **AI GPU cluster** | 2 hosts with GPUs, 4 workers each | ~3,200 inferences/sec |
| **Multi-region** | Active-passive or active-active regions | Disaster recovery |

| Component | Configuration | Capacity |
|---|---|---|
| **Backend** | 4 hosts × PM2 ×4 = 16 processes | ~50,000 API req/sec |
| **Ingestion** | Kafka + 8 workers | ~100,000 EPS |
| **AI Engine** | 2 GPU hosts, 8 workers | ~3,200 inferences/sec |
| **PostgreSQL** | Primary + 2 replicas, PgBouncer | ~500M incidents |
| **MongoDB** | 3 shards × 3 replicas | ~100B events |
| **Redis** | 6-node cluster | Unlimited cache + queue HA |

---

### 1.6 Tier Comparison Summary

| Dimension | 100 Users | 1,000 Users | 10,000 Users | 100,000 Users |
|---|---|---|---|---|
| **EPS** | 500 | 2,000 | 10,000 | 100,000 |
| **Backend processes** | 1 | 4 (PM2) | 8 (2 hosts) | 16 (4 hosts) |
| **BullMQ workers** | 4 | 8 | 16 | Kafka + 8 |
| **AI workers** | 1 | 2 | 4 | 8 (GPU) |
| **Collectors** | 1 | 3 | 10+ | 50+ |
| **PostgreSQL** | Local | PgBouncer | Primary + replica | Primary + 2 replicas |
| **MongoDB** | Local | Tuned cache | Replica set | 3-shard cluster |
| **Redis** | Local | 2 GB | Sentinel HA | 6-node cluster |
| **Hosts total** | 1 | 1 | 5-6 | 15+ |
| **RAM total** | 16 GB | 64 GB | 512 GB | 2+ TB |
| **Storage** | 500 GB | 2 TB | 10 TB | 50+ TB |
| **Architecture** | Monolith | Monolith + tuning | Split hosts | Partial microservices |

---

## 2. Caching

### 2.1 Caching Architecture

```mermaid
graph TB
    subgraph CACHE_ARCH["Caching Layers"]

        subgraph L1["Layer 1: Application Memory"]
            RULE_CACHE["CompiledRule Cache<br/>(in-process Map)"]
            CONFIG_CACHE["Config Cache<br/>(in-process, 5-min TTL)"]
            MODEL_CACHE["Loaded ML Model<br/>(in-process, persistent)"]
        end

        subgraph L2["Layer 2: Redis"]
            DASH_CACHE["Dashboard Summary<br/>(30s TTL)"]
            SESSION_CACHE["Session Lookup<br/>(1h TTL, matches JWT)"]
            RATE_LIMIT_CACHE["Rate Limit Counters<br/>(60s TTL)"]
            RULE_STATE["Rule State<br/>(cooldowns, counts, sequences)"]
            ASSET_CACHE["Asset Criticality Map<br/>(5-min TTL)"]
            TIMELINE_CACHE["Incident Timeline Cache<br/>(10s TTL)"]
        end

        subgraph L3["Layer 3: Database"]
            PG_DATA["PostgreSQL<br/>(source of truth for relational)"]
            MDB_DATA["MongoDB<br/>(source of truth for events)"]
        end
    end

    REQ["Request"] --> L1
    L1 -->|"miss"| L2
    L2 -->|"miss"| L3
    L3 -->|"populate"| L2
    L3 -->|"populate"| L1

    style L1 fill:#27ae60,color:#fff
    style L2 fill:#f39c12,color:#fff
    style L3 fill:#3498db,color:#fff
```

### 2.2 Cache Key Design

| Cache Item | Key Pattern | TTL | Invalidation |
|---|---|---|---|
| Dashboard summary | `cache:dash:summary:{range}` | 30s | TTL expiry (auto) |
| Dashboard timeline | `cache:dash:timeline:{range}:{interval}` | 30s | TTL expiry |
| Top assets | `cache:dash:assets:{range}` | 60s | TTL expiry |
| Source breakdown | `cache:dash:sources:{range}` | 60s | TTL expiry |
| Session lookup | `cache:session:{jti}` | 1h | Explicit delete on logout/revoke |
| Incident detail | `cache:incident:{id}` | 10s | Explicit delete on update |
| Rule list | `cache:rules:list:{hash(filters)}` | 60s | Explicit delete on rule CRUD |
| Asset criticality | `cache:asset:crit:{hostname}` | 5m | Explicit delete on asset update |
| Rate limit | `rl:{tier}:{key}` | 60s | TTL expiry |
| Rule cooldown | `rule:cooldown:{ruleId}:{entity}` | Varies | TTL expiry (matches cooldown period) |
| Rule count window | `rule:count:{ruleId}:{field}:{value}` | Varies | TTL expiry (matches time window) |

### 2.3 Cache-Aside Pattern

```mermaid
sequenceDiagram
    participant Client
    participant API as API Handler
    participant Redis
    participant DB as PostgreSQL

    Client->>API: GET /dashboard/summary?range=24h

    API->>Redis: GET cache:dash:summary:24h
    alt Cache HIT
        Redis-->>API: Cached data
        API-->>Client: 200 OK (from cache)
    else Cache MISS
        Redis-->>API: null
        API->>DB: SELECT aggregated metrics...
        DB-->>API: Fresh data
        API->>Redis: SETEX cache:dash:summary:24h 30 {data}
        Redis-->>API: OK
        API-->>Client: 200 OK (from DB)
    end
```

### 2.4 Cache Invalidation Strategy

| Strategy | Used For | How |
|---|---|---|
| **TTL expiry** | Dashboard, timelines, counters | Data auto-expires. Next request fetches fresh. Simplest approach |
| **Explicit delete** | Sessions, incidents, rules, assets | On CRUD operation, `DEL cache:key`. Next request populates fresh |
| **Write-through** | Rule compilation cache | On rule update, recompile and update cache in same operation |
| **Never cached** | Audit logs, event search | Always fetched from database. Too variable to cache |

### 2.5 Cache Hit Rate Targets

| Endpoint | Expected Hit Rate | Impact |
|---|---|---|
| Dashboard summary | 95%+ | Dashboard is viewed constantly by many analysts. 30s TTL means 1 DB query per 30s regardless of viewer count |
| Session lookup | 99%+ | Every authenticated request checks session. Cache prevents a PostgreSQL query per request |
| Asset criticality | 90%+ | Looked up during risk scoring. Assets change rarely |
| Incident detail | 70% | Moderate — analysts open and close different incidents |
| Rule list | 80% | Viewed often, changed rarely |

### 2.6 Cache Sizing by Tier

| Tier | Redis Memory | Key Count | Description |
|---|---|---|---|
| 100 users | 512 MB | ~10,000 | Dashboard, sessions, rule state |
| 1,000 users | 2 GB | ~100,000 | + rate limits, asset map |
| 10,000 users | 8 GB | ~1,000,000 | + incident cache, timeline cache |
| 100,000 users | Redis Cluster 48 GB | ~10,000,000 | Full cache + distributed queue |

---

## 3. Database Scaling

### 3.1 PostgreSQL Scaling Strategy

```mermaid
graph TB
    subgraph PG_SCALE["PostgreSQL Scaling Stages"]

        subgraph S1["Stage 1: Single Instance"]
            PG_S1["PostgreSQL<br/>4 GB RAM<br/>Direct connections"]
        end

        subgraph S2["Stage 2: Connection Pooling"]
            PGB["PgBouncer<br/>(transaction pooling)<br/>50 DB connections<br/>1000 client connections"]
            PG_S2["PostgreSQL<br/>16 GB RAM"]
        end

        subgraph S3["Stage 3: Read Replicas"]
            PG_W["Primary<br/>(write)"]
            PG_R1["Replica 1<br/>(dashboard reads)"]
            PG_R2["Replica 2<br/>(search, export)"]
        end

        subgraph S4["Stage 4: Partitioning + Archival"]
            PG_ACTIVE["Active Partitions<br/>(last 12 months)"]
            PG_ARCHIVE["Archived Partitions<br/>(cold storage)"]
        end
    end

    S1 -->|"1K users"| S2
    S2 -->|"10K users"| S3
    S3 -->|"100K users"| S4
```

### 3.2 PostgreSQL Partition Strategy

| Table | Partition Key | Interval | Active Partitions | Archive After |
|---|---|---|---|---|
| `incidents` | `created_at` | Monthly | 12 months | 24 months |
| `alerts` | `created_at` | Monthly | 12 months | 24 months |
| `incident_events` | `linked_at` | Monthly | 12 months | 24 months |
| `audit.audit_logs` | `created_at` | Monthly | 24 months | 36 months |
| `users` | None | Not partitioned | — | Never archived |
| `rules` | None | Not partitioned | — | Never archived |

### 3.3 PostgreSQL Index Strategy

| Table | Index | Type | Purpose |
|---|---|---|---|
| `incidents` | `(status, severity, created_at DESC)` | B-tree composite | Incident list with filters |
| `incidents` | `(primary_entity)` | B-tree | Entity correlation lookup |
| `incidents` | `(assigned_to) WHERE status IN ('open','investigating')` | Partial index | Analyst queue |
| `alerts` | `(incident_id, created_at)` | B-tree composite | Alert timeline |
| `alerts` | `(rule_id, created_at)` | B-tree composite | Rule performance metrics |
| `audit.audit_logs` | `(action, created_at)` | B-tree composite | Audit search |
| `audit.audit_logs` | `(actor_id, created_at)` | B-tree composite | User activity search |
| `sessions` | `(jwt_id) WHERE revoked_at IS NULL` | Partial unique | Active session lookup |

### 3.4 MongoDB Scaling Strategy

```mermaid
graph TB
    subgraph MDB_SCALE["MongoDB Scaling Stages"]

        subgraph MS1["Stage 1: Single Instance"]
            MDB_S1["MongoDB<br/>4 GB WiredTiger cache"]
        end

        subgraph MS2["Stage 2: Replica Set"]
            MDB_PRI["Primary<br/>(write)"]
            MDB_SEC1["Secondary 1<br/>(read: investigation)"]
            MDB_SEC2["Secondary 2<br/>(read: search/export)"]
        end

        subgraph MS3["Stage 3: Sharded Cluster"]
            MONGOS["mongos Router"]
            SHARD1["Shard 1<br/>(events Jan-Apr)"]
            SHARD2["Shard 2<br/>(events May-Aug)"]
            SHARD3["Shard 3<br/>(events Sep-Dec)"]
        end
    end

    MS1 -->|"1K users"| MS2
    MS2 -->|"100K users"| MS3
```

### 3.5 MongoDB Index Strategy

| Collection | Index | Type | Purpose |
|---|---|---|---|
| `normalized_events` | `{ time: -1 }` | Descending | Time-based queries (primary access pattern) |
| `normalized_events` | `{ "src_endpoint.ip": 1, time: -1 }` | Compound | Source IP investigation |
| `normalized_events` | `{ "actor.user.name": 1, time: -1 }` | Compound | User investigation |
| `normalized_events` | `{ "device.hostname": 1, time: -1 }` | Compound | Host investigation |
| `normalized_events` | `{ class_uid: 1, time: -1 }` | Compound | Class-filtered queries |
| `normalized_events` | `{ event_id: 1 }` | Unique | Single event lookup |
| `normalized_events` | `{ message: "text" }` | Text | Full-text search |
| `normalized_events` | `{ time: 1 }` | TTL (90 days) | Automatic data expiry |

### 3.6 MongoDB Sharding Key (Tier 4)

| Shard Key | Value |
|---|---|
| **Key** | `{ time: 1 }` (range-based) |
| **Rationale** | Events are always queried by time range. Range sharding places temporal neighbors on the same shard, minimizing cross-shard scatter |
| **Chunk size** | 64 MB (default) |
| **Balancer** | Enabled, runs during off-peak hours |

### 3.7 Database Connection Pools

| Tier | PostgreSQL Pool | MongoDB Pool | Redis Pool |
|---|---|---|---|
| 100 users | 10 connections | 10 connections | 10 connections |
| 1,000 users | PgBouncer: 50 DB / 1000 client | 50 connections | 50 connections |
| 10,000 users | PgBouncer: 100 DB / 5000 client | 100 connections (per replica) | Sentinel managed |
| 100,000 users | PgBouncer: 200 DB / 10000 client | 200 per shard router | Cluster managed |

---

## 4. Worker Scaling

### 4.1 Worker Architecture

Workers are the units that process events through the detection pipeline. They pull jobs from the BullMQ processing queue and run the pipeline stages (parse → normalize → extract → detect → correlate).

```mermaid
graph TB
    subgraph WORKER_ARCH["Worker Scaling Architecture"]

        subgraph QUEUE_SRC["Processing Queue (BullMQ / Redis)"]
            Q["Pending Jobs<br/>(batch files to process)"]
        end

        subgraph WORKERS["Worker Pool"]
            W1["Worker 1<br/>(pipeline stages)"]
            W2["Worker 2<br/>(pipeline stages)"]
            W3["Worker 3<br/>(pipeline stages)"]
            W4["Worker 4<br/>(pipeline stages)"]
        end

        subgraph PIPELINE["Pipeline per Worker"]
            PARSE["Parse"]
            NORM["Normalize"]
            FEAT["Feature Extract"]
            RULE["Rule Evaluate"]
            AI_W["AI Client"]
            CORR["Correlate"]
            STORE["Store"]
        end
    end

    Q --> W1
    Q --> W2
    Q --> W3
    Q --> W4
    W1 --> PARSE --> NORM --> FEAT --> RULE --> AI_W --> CORR --> STORE

    style WORKERS fill:#f39c12,color:#fff
```

### 4.2 Workers per Tier

| Tier | Workers | Worker Concurrency | Throughput |
|---|---|---|---|
| 100 users | 4 workers (1 Node.js process) | 4 concurrent jobs | ~500 EPS |
| 1,000 users | 8 workers (4 PM2 processes × 2) | 8 concurrent jobs | ~2,000 EPS |
| 10,000 users | 16 workers (2 hosts × 4 PM2 × 2) | 16 concurrent jobs | ~10,000 EPS |
| 100,000 users | 32+ workers (4 hosts × 4 PM2 × 2) + Kafka consumers | 32+ concurrent | ~100,000 EPS |

### 4.3 Worker Scaling Rules

```mermaid
flowchart TD
    MONITOR["Monitor queue depth<br/>every 30 seconds"]
    CHECK{"Queue depth<br/>> high_watermark?"}
    SCALE_UP["Scale: Start additional<br/>PM2 worker process"]
    UNDER{"Queue depth<br/>< low_watermark<br/>for 5 minutes?"}
    SCALE_DOWN["Scale: Stop surplus<br/>worker process<br/>(keep minimum)"]
    OK["No action"]

    MONITOR --> CHECK
    CHECK -->|"yes"| SCALE_UP
    CHECK -->|"no"| UNDER
    UNDER -->|"yes"| SCALE_DOWN
    UNDER -->|"no"| OK
```

| Setting | Default | Description |
|---|---|---|
| `workers.min_count` | 4 | Minimum workers (never scale below) |
| `workers.max_count` | 16 | Maximum workers per host |
| `workers.high_watermark` | 1000 | Queue depth to trigger scale-up |
| `workers.low_watermark` | 50 | Queue depth to trigger scale-down |
| `workers.cooldown_seconds` | 300 | Minimum time between scaling events |

### 4.4 Worker Job Processing

Each worker processes one batch file (job) at a time:

| Stage | Avg Duration | Bottleneck Factor |
|---|---|---|
| Parse (OCSF validation) | 5ms per event | CPU |
| Normalize (field mapping) | 2ms per event | CPU |
| Feature Extract (temporal, frequency, entropy) | 10ms per event | CPU + Redis |
| Rule Evaluate (compiled functions) | 1ms per event | CPU |
| AI Client (HTTP to AI Engine) | 45ms per batch (100 events) | Network + AI compute |
| Correlate (entity match, risk score) | 5ms per incident | CPU + PostgreSQL |
| Store (PostgreSQL + MongoDB) | 20ms per batch | I/O |

**Total per 100-event batch:** ~150ms → ~650 events/sec/worker.

### 4.5 Worker Backpressure

If workers cannot keep up with ingestion:

| Queue Depth | Action |
|---|---|
| 0-100 | Normal operation |
| 100-1,000 | Warning logged. Scale-up triggered if auto-scaling enabled |
| 1,000-10,000 | Alert to SOC: "Processing backlog detected" |
| 10,000+ | Critical alert. Oldest jobs prioritized. New batch files may be delayed (Directory Watcher pauses file pickup until queue drains below 5,000) |

---

## 5. Queue Scaling

### 5.1 Queue Architecture

The processing queue is abstracted behind `IProcessingQueue` (as defined in ADR-001). The MVP uses BullMQ backed by Redis.

```mermaid
graph TB
    subgraph QUEUE_SCALE["Queue Scaling Strategy"]

        subgraph S1_Q["Tier 1-2: BullMQ (Single Redis)"]
            BULL["BullMQ Queue<br/>'processing-queue'"]
            RD_Q1["Redis<br/>(single instance)"]
            BULL --> RD_Q1
        end

        subgraph S2_Q["Tier 3: BullMQ (Redis Sentinel)"]
            BULL_HA["BullMQ Queue<br/>'processing-queue'"]
            SENTINEL["Redis Sentinel<br/>(auto-failover)"]
            RD_M["Redis Master"]
            RD_S["Redis Slave"]
            BULL_HA --> SENTINEL --> RD_M
            RD_M --> RD_S
        end

        subgraph S3_Q["Tier 4: Kafka"]
            KAFKA_Q["Apache Kafka<br/>topic: siem.raw-events"]
            KAFKA_P1["Partition 0"]
            KAFKA_P2["Partition 1"]
            KAFKA_P3["Partition 2"]
            KAFKA_P4["Partition 3"]
            KAFKA_Q --> KAFKA_P1
            KAFKA_Q --> KAFKA_P2
            KAFKA_Q --> KAFKA_P3
            KAFKA_Q --> KAFKA_P4
        end
    end

    S1_Q -->|"HA needed"| S2_Q
    S2_Q -->|"100K EPS"| S3_Q
```

### 5.2 BullMQ Configuration by Tier

| Setting | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| `maxRetriesPerRequest` | 3 | 3 | 3 |
| `concurrency` (per worker) | 4 | 2 | 2 |
| `removeOnComplete` | `{ count: 1000 }` | `{ count: 5000 }` | `{ count: 10000 }` |
| `removeOnFail` | `{ count: 500 }` | `{ count: 2000 }` | `{ count: 5000 }` |
| `attempts` | 3 | 3 | 3 |
| `backoff` | `{ type: "exponential", delay: 1000 }` | Same | Same |
| `stalledInterval` | 30,000 ms | 30,000 ms | 30,000 ms |
| `lockDuration` | 60,000 ms | 60,000 ms | 120,000 ms |

### 5.3 Queue Monitoring Metrics

| Metric | Source | Alert Threshold |
|---|---|---|
| `queue.waiting` | BullMQ `getWaitingCount()` | > 1,000 → Warning, > 10,000 → Critical |
| `queue.active` | BullMQ `getActiveCount()` | Should equal worker count |
| `queue.failed` | BullMQ `getFailedCount()` | > 100/hour → Warning |
| `queue.completed_rate` | Calculated | < expected EPS → Warning |
| `queue.job_duration_p99` | BullMQ job lifecycle | > 5,000ms → Warning |
| `queue.dead_letter_count` | Dead letter queue | Any → Alert |

### 5.4 Dead Letter Queue

Jobs that fail all retry attempts are moved to a dead letter queue for manual review:

```mermaid
flowchart TD
    JOB["Job: process batch_001.json"]
    ATTEMPT1["Attempt 1: FAIL<br/>(e.g., MongoDB timeout)"]
    WAIT1["Wait 1s (exponential backoff)"]
    ATTEMPT2["Attempt 2: FAIL"]
    WAIT2["Wait 2s"]
    ATTEMPT3["Attempt 3: FAIL"]
    DLQ["Dead Letter Queue<br/>(manual review required)"]
    QUARANTINE_Q["Move batch file<br/>to quarantine directory"]
    NOTIFY_Q["Alert SOC:<br/>Batch processing failed"]

    JOB --> ATTEMPT1 --> WAIT1 --> ATTEMPT2 --> WAIT2 --> ATTEMPT3 --> DLQ
    DLQ --> QUARANTINE_Q
    DLQ --> NOTIFY_Q

    style DLQ fill:#e74c3c,color:#fff
```

### 5.5 IProcessingQueue Interface (Queue Abstraction)

The `IProcessingQueue` interface allows swapping BullMQ for Kafka at Tier 4 without changing worker code:

```typescript
// IProcessingQueue — same interface for BullMQ or Kafka

interface IProcessingQueue {
  enqueue(job: ProcessingJob): Promise<string>;
  onJob(handler: (job: ProcessingJob) => Promise<void>): void;
  getStats(): Promise<QueueStats>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

// BullMQProcessingQueue implements IProcessingQueue  (Tier 1-3)
// KafkaProcessingQueue implements IProcessingQueue   (Tier 4)
```

---

## 6. Collector Scaling

### 6.1 Collector Deployment Models

```mermaid
graph TB
    subgraph MODELS["Collector Scaling Models"]

        subgraph M1["Model 1: Local Collector<br/>(Tier 1)"]
            HOST1["Single host"]
            COL1["1 Collector<br/>reads local logs"]
            HOST1 --> COL1
        end

        subgraph M2["Model 2: Per-Site Collectors<br/>(Tier 2-3)"]
            SITE_A["Site A"]
            SITE_B["Site B"]
            COL_A2["Collector A"]
            COL_B2["Collector B"]
            SITE_A --> COL_A2
            SITE_B --> COL_B2
        end

        subgraph M3["Model 3: Per-Role Collectors<br/>(Tier 3-4)"]
            NET["Network Devices"]
            WIN["Windows Servers"]
            LIN["Linux Servers"]
            APP["Applications"]
            COL_NET["Collector-Network"]
            COL_WIN["Collector-Windows"]
            COL_LIN["Collector-Linux"]
            COL_APP["Collector-App"]
            NET --> COL_NET
            WIN --> COL_WIN
            LIN --> COL_LIN
            APP --> COL_APP
        end
    end

    style M1 fill:#27ae60,color:#fff
    style M2 fill:#3498db,color:#fff
    style M3 fill:#f39c12,color:#fff
```

### 6.2 Collectors per Tier

| Tier | Collectors | Deployment | Transport |
|---|---|---|---|
| 100 users | 1 | Local on backend host | Local filesystem |
| 1,000 users | 3-5 | Per site/network segment | NFS mount or rsync |
| 10,000 users | 10-20 | Per role + per site | NFS or rsync to central storage |
| 100,000 users | 50+ | Per role + per site + per region | Kafka producer (direct publish) |

### 6.3 Single Collector Capacity

Each C++ Collector instance has the following capacity based on log source type:

| Source Type | EPS per Collector | Limiting Factor |
|---|---|---|
| File (flat log) | ~5,000 EPS | Disk I/O read speed |
| Syslog (UDP) | ~10,000 EPS | Network + parse speed |
| Windows ETW | ~3,000 EPS | ETW buffer speed |
| HTTP (webhook) | ~2,000 EPS | Network + TLS overhead |

### 6.4 Collector Resource Requirements

| EPS Range | CPU Cores | RAM | Disk I/O |
|---|---|---|---|
| 0-1,000 | 1 core | 128 MB | 10 MB/s write |
| 1,000-5,000 | 2 cores | 256 MB | 50 MB/s write |
| 5,000-10,000 | 4 cores | 512 MB | 100 MB/s write |

### 6.5 Collector Batch Size Scaling

| EPS | Batch Size | Batch Interval | File Size |
|---|---|---|---|
| 100 | 100 events | 10s | ~50 KB |
| 500 | 500 events | 10s | ~250 KB |
| 2,000 | 1,000 events | 5s | ~500 KB |
| 10,000 | 5,000 events | 5s | ~2.5 MB |

### 6.6 Collector Transport Scaling

```mermaid
graph TB
    subgraph TRANSPORT["Collector File Transport"]

        subgraph T1["Tier 1-2: Local / NFS"]
            COL_T1["Collector"]
            FS_T1["Shared Filesystem<br/>(local or NFS mount)"]
            BE_T1["Backend<br/>Directory Watcher"]
            COL_T1 -->|"write"| FS_T1
            FS_T1 -->|"inotify / chokidar"| BE_T1
        end

        subgraph T2["Tier 3: rsync"]
            COL_T2["Remote Collector"]
            RSYNC["rsync over SSH<br/>(every 5s cron)"]
            FS_T2["Central Filesystem"]
            BE_T2["Backend<br/>Directory Watcher"]
            COL_T2 --> RSYNC --> FS_T2 --> BE_T2
        end

        subgraph T3["Tier 4: Kafka"]
            COL_T3["Collector<br/>(Kafka Producer)"]
            KAFKA_T["Kafka Broker<br/>topic: siem.raw-events"]
            CONSUMER["Backend<br/>(Kafka Consumer)"]
            COL_T3 --> KAFKA_T --> CONSUMER
        end
    end

    T1 -->|"remote sites"| T2
    T2 -->|"100K EPS"| T3
```

### 6.7 Collector High Availability

| Strategy | Tier | Description |
|---|---|---|
| **Checkpoint recovery** | All tiers | Collector resumes from last checkpoint on restart. No duplicate or lost events |
| **Watchdog process** | Tier 2+ | Systemd service with `Restart=always`. Auto-restart on crash |
| **Dual collectors** | Tier 3+ | Two collectors per critical site in active-passive mode. Passive takes over if active goes offline |
| **Collector fleet management** | Tier 4 | Central management of collector config, versioning, and deployment via Ansible or similar |

### 6.8 Collector Monitoring

| Metric | Source | Alert |
|---|---|---|
| Heartbeat interval | Heartbeat file (every 30s) | Missing 2+ heartbeats → Collector Offline alert |
| EPS rate | Heartbeat metadata | Drop > 50% from baseline → Warning |
| Error count | Heartbeat metadata | > 10 errors/hour → Warning |
| Checkpoint lag | Checkpoint file vs log file position | Lag > 5 min of data → Warning |
| Disk usage | Heartbeat metadata | Collector output dir > 80% → Warning |
| CPU / Memory | Heartbeat metadata | CPU > 90% sustained or Memory > 90% → Warning |

---

## Scaling Decision Tree

```mermaid
flowchart TD
    START["Current capacity<br/>sufficient?"]
    YES["No action needed"]
    NO["Identify bottleneck"]

    CPU{"CPU-bound?"}
    IO{"I/O-bound?"}
    MEM{"Memory-bound?"}
    NET{"Network-bound?"}

    CPU_FIX["Add PM2 workers<br/>Add backend host<br/>Add AI workers"]
    IO_FIX["SSD upgrade<br/>PostgreSQL read replica<br/>MongoDB replica set"]
    MEM_FIX["Increase RAM<br/>Tune WiredTiger cache<br/>Increase Redis maxmemory"]
    NET_FIX["Batch size tuning<br/>Connection pooling<br/>Reduce HTTP round-trips"]

    START -->|"yes"| YES
    START -->|"no"| NO
    NO --> CPU
    NO --> IO
    NO --> MEM
    NO --> NET
    CPU -->|"yes"| CPU_FIX
    IO -->|"yes"| IO_FIX
    MEM -->|"yes"| MEM_FIX
    NET -->|"yes"| NET_FIX

    style YES fill:#27ae60,color:#fff
    style CPU_FIX fill:#3498db,color:#fff
    style IO_FIX fill:#f39c12,color:#fff
    style MEM_FIX fill:#8e44ad,color:#fff
    style NET_FIX fill:#e74c3c,color:#fff
```

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). Tiers 1-3 maintain the Modular Monolith architecture. Tier 4 introduces a controlled architectural evolution (Kafka, MongoDB sharding) as a planned upgrade path. All scaling decisions prioritize vertical scaling and tuning before horizontal splitting.**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-19
