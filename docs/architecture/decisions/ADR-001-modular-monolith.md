# ADR-001: Modular Monolith Architecture for AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **ADR ID** | ADR-001 |
| **Title** | Modular Monolith Architecture |
| **Status** | 🔒 **Accepted — Frozen** |
| **Date** | 2026-07-18 |
| **Decision Makers** | Project Owner + Lead Architect |
| **Supersedes** | N/A (initial architecture decision) |

---

## 1. Context

We are building an **AI-Powered Security Analytics Platform** (AI SIEM) that collects security logs from multiple sources (Windows, Linux, network devices, applications), normalizes them into a common schema, detects threats using rule-based and AI-driven analysis, correlates incidents, scores risk, and presents findings through a real-time SOC analyst dashboard.

### Constraints

- **Single engineer** with a 4–6 month development timeline
- Must be **production-inspired** — demonstrating software engineering excellence
- Must be **deployable with a single command** (Docker Compose)
- Must be **testable, maintainable, and extensible** without excessive operational overhead
- Must support **future evolution** (multi-tenancy, additional AI models, alternative queue backends) without architectural rewrites

---

## 2. Decision

We adopt a **Modular Monolith** architecture with **4 separate processes** communicating through **file-based I/O** and **HTTP REST**.

### 2.1 Architecture Style: Modular Monolith

The backend is a **single Node.js Express application** organized into strictly bounded modules. Each module is a vertical slice following Clean Architecture (domain → application → infrastructure → interface). Modules communicate through interfaces, never through direct class instantiation.

**Rationale:**
- A single engineer cannot effectively operate a distributed microservices platform
- A modular monolith provides the same separation of concerns without the operational tax
- Module boundaries can be promoted to service boundaries in the future if needed
- Deployment, debugging, and testing are dramatically simpler

**Rejected alternatives:**
- **Microservices**: Operational overhead (Kafka, K8s, service mesh, distributed tracing) is prohibitive for a single engineer
- **Traditional Monolith (no module boundaries)**: Would create a tightly coupled codebase that resists change

### 2.2 System Processes

| Process | Language | Responsibility |
|---|---|---|
| **Collector** | C++ (C++20) | Collect logs → convert to OCSF JSON → batch → atomic file write |
| **Backend** | Node.js + Express + TypeScript | Directory watcher → queue → pipeline (parse, normalize, detect, correlate, score) → API |
| **AI Engine** | Python + FastAPI | Isolation Forest anomaly detection, SHAP explainability, optional threat classification |
| **Frontend** | Next.js (React + TypeScript) | SOC analyst dashboard, collector monitoring, incident management |

### 2.3 Inter-Process Communication

| Path | Mechanism | Rationale |
|---|---|---|
| Collector → Backend | **File-based** (atomic write to shared directory) | Simplest possible integration; collector directory acts as natural buffer; no broker needed |
| Backend → AI Engine | **HTTP REST** | Synchronous request/response for inference; stateless; simple to debug |
| Frontend → Backend | **HTTP REST + WebSocket** | REST for CRUD operations; WebSocket (via Redis Pub/Sub) for real-time dashboard updates |

**No message brokers, no gRPC, no service mesh, no event bus.**

---

## 3. Architectural Decisions (Frozen)

### D1 — Architecture Style

| | |
|---|---|
| **Decision** | Modular Monolith |
| **Status** | 🔒 Frozen |
| **Rationale** | Single-engineer feasibility; clean module boundaries without distributed systems complexity |
| **Constraint** | Do not introduce microservices, service mesh, or container orchestration |

### D2 — Event Schema Standard

| | |
|---|---|
| **Decision** | OCSF (Open Cybersecurity Schema Framework) |
| **Status** | 🔒 Frozen |
| **Rationale** | Vendor-neutral, industry-backed (AWS, Splunk, IBM), purpose-built for security events |
| **Extension Policy** | If OCSF lacks a required field, add it as a documented extension under `unmapped` — never create a custom schema. Track extensions in `docs/architecture/ocsf-extensions.md` |

### D3 — Programming Languages

| | |
|---|---|
| **Decision** | C++ (Collector) / Node.js + TypeScript (Backend) / Python (AI) / Next.js + TypeScript (Frontend) |
| **Status** | 🔒 Frozen |
| **Rationale** | C++ for performance-critical collection; Node.js for async I/O and Express ecosystem; Python for ML ecosystem; Next.js for SSR and React ecosystem |

### D4 — Storage

| | |
|---|---|
| **Decision** | PostgreSQL + MongoDB + Redis |
| **Status** | 🔒 Frozen |
| **PostgreSQL** | Structured data: users, rules, incidents, audit logs, configs, asset inventory, collector status |
| **MongoDB** | Semi-structured data: raw logs, OCSF-normalized events, AI/ML results, enrichment cache |
| **Redis** | Ephemeral data: processing queue (BullMQ), session store, pub/sub, rate limiting, feature cache |

### D5 — Message/Queue Strategy

| | |
|---|---|
| **Decision** | No message broker. File-based collector output + Redis-backed BullMQ behind `IProcessingQueue` interface |
| **Status** | 🔒 Frozen |
| **Rationale** | Eliminates Kafka/Redpanda/Pulsar operational complexity. BullMQ provides persistent job queue with retry, priority, and dead-letter support. The `IProcessingQueue` abstraction allows future replacement without touching business logic |
| **Constraint** | Do not introduce Kafka, Redpanda, Pulsar, RabbitMQ, or any distributed message broker |

### D6 — Frontend Framework

| | |
|---|---|
| **Decision** | Next.js (React + TypeScript) |
| **Status** | 🔒 Frozen |
| **Rationale** | SSR for fast initial load, App Router for file-based routing, React ecosystem for complex interactive dashboards, API routes available for BFF pattern |

### D7 — Project Layout

| | |
|---|---|
| **Decision** | Modular layout with dedicated `workers/` directory in backend |
| **Status** | 🔒 Frozen |
| **Key Structure** | `backend/src/modules/` (vertical slices), `backend/src/workers/` (independent job processors), `backend/src/shared/` (shared kernel) |
| **Rationale** | Workers process jobs from `IProcessingQueue` independently of the Directory Watcher — separation of ingestion trigger from processing logic |

### D8 — Multi-Tenancy

| | |
|---|---|
| **Decision** | Single-tenant MVP; architecture designed for future multi-tenancy |
| **Status** | 🔒 Frozen |
| **MVP Scope** | Single organization, single SOC team. No tenant isolation, management, or tenant-aware data models |
| **Future Path** | Repository interfaces accept optional `orgId` (ignored in MVP); DB schemas include reserved `org_id` column; config supports namespace prefixes |

### D9 — ML/AI Strategy

| | |
|---|---|
| **Decision** | Python FastAPI with Isolation Forest + SHAP for MVP |
| **Status** | 🔒 Frozen |
| **MVP Features** | Anomaly detection (Isolation Forest), explainability (SHAP), optional threat classification (Random Forest/XGBoost) |
| **Model Management** | Models trained offline (Jupyter), serialized (joblib/ONNX), loaded at startup. Version pointer in `models/config.json` |
| **Excluded from MVP** | NLP search, log clustering, LLM-based rule generation, deep learning pipelines, online learning |
| **Constraint** | Do not introduce MLflow, Ray, Kubeflow, or any ML platform infrastructure |

### D10 — Deployment

| | |
|---|---|
| **Decision** | Docker Compose (single command to run everything) |
| **Status** | 🔒 Frozen |
| **Rationale** | Single-engineer operation; entire stack starts with `docker-compose up`; no orchestration needed |
| **Constraint** | Do not introduce Kubernetes, Terraform, Helm, or any cloud-native deployment tooling |

---

## 4. Design Principles (Enforced)

| Principle | Application |
|---|---|
| **Clean Architecture** | 4 concentric layers: Domain → Application → Infrastructure → Interface. Dependencies point inward only |
| **SOLID** | Single Responsibility (one reason to change per class), Open/Closed (extend via interfaces), Liskov Substitution (implementations are interchangeable), Interface Segregation (narrow interfaces), Dependency Inversion (depend on abstractions) |
| **Repository Pattern** | All data access via repository interfaces (`IIncidentRepository`, `ILogRepository`, `IRuleRepository`). Defined in domain layer, implemented in infrastructure |
| **Dependency Injection** | All dependencies injected via constructors. No `new ConcreteClass()` in business logic. Enables testing with mocks |
| **Interface-First Design** | `IProcessingQueue`, `IAIClient`, `IRuleEngine` — all major components are interfaces. Implementations are swappable |
| **Separation of Concerns** | Each module owns its domain completely. No shared mutable state between modules |

---

## 5. Collector Architecture (Frozen)

### Pipeline

```
Collect Logs → Convert to OCSF JSON → Batch Logs → Atomic File Write (.tmp → .json) → Collector Directory
```

### Responsibilities (Exhaustive)

| ✅ Does | ❌ Never Does |
|---|---|
| Read logs (syslog, file tail, ETW, HTTP) | Parsing / detection logic |
| Convert to OCSF JSON | AI inference |
| Batch by count or time window | Incident generation |
| Maintain read checkpoints | Database operations |
| Write files atomically (.tmp → .json) | Network communication with backend |
| Emit heartbeat status files | Any business logic |

---

## 6. Queue Abstraction (Frozen)

```
Directory Watcher
       │
       ▼
IProcessingQueue  ← Interface (domain layer)
       │
       ▼
BullMQQueue       ← Implementation (infrastructure layer)
       │
       ▼
Worker Pool       ← Independent job processors (backend/src/workers/)
```

**Interface contract:**
- `enqueue(job: QueueJob): Promise<string>`
- `dequeue(): Promise<QueueJob | null>`
- `retry(jobId: string): Promise<void>`
- `deadLetter(job: QueueJob, reason: string): Promise<void>`
- `getStatus(): Promise<QueueStatus>`

---

## 7. AI Engine Scope (Frozen)

### MVP

| Feature | Model | Endpoint |
|---|---|---|
| Anomaly Detection | Isolation Forest | `POST /api/v1/detect/anomaly` |
| Explainability | SHAP | `POST /api/v1/explain` |
| Threat Classification (optional) | Random Forest / XGBoost | `POST /api/v1/classify/threat` |
| Health Check | — | `GET /api/v1/health` |

### Future Enhancements (Not in MVP)

- NLP-based log search
- Log clustering (DBSCAN/HDBSCAN)
- LLM-based Sigma rule generation
- Deep learning pipelines (autoencoders, GNNs)
- Online learning from analyst feedback

---

## 8. Frontend — Collector Monitoring (Added)

The dashboard includes a dedicated **Collector Monitoring** module:

| Metric | Source |
|---|---|
| Collector Status (Online/Offline/Degraded) | Heartbeat file |
| Last Heartbeat | Heartbeat timestamp |
| Files Processed | Backend counter |
| Queue Size | `IProcessingQueue.getStatus()` |
| Failed Files | Quarantine + dead-letter queue |
| Collector Health (CPU/mem/disk) | Heartbeat status file |
| Last Batch Processed | Backend processing timestamp |

---

## 9. Consequences

### Positive

- **Single engineer can build, deploy, and maintain** the entire system within 4–6 months
- **Clean module boundaries** allow future extraction to microservices if scale demands it
- **Interface-first design** makes every major component swappable (queue, AI, storage)
- **Single `docker-compose up`** starts the entire platform — no ops expertise required
- **File-based collector communication** is trivially debuggable (ls the directory, cat the files)
- **OCSF adoption** provides industry-standard schema from day one

### Negative (Accepted Trade-offs)

- **Single process backend** limits vertical scaling to one machine (acceptable for MVP scope)
- **File-based communication** has lower throughput than Kafka (acceptable — not targeting enterprise scale in MVP)
- **Simplified AI** (Isolation Forest only) may miss complex threats (acceptable — extensible via `IAIClient` interface)
- **No multi-tenancy** limits deployment to single organization (acceptable — designed for future addition)

---

## 10. Future Evolution Path

| Current (MVP) | Future (Post-MVP) | Migration Path |
|---|---|---|
| BullMQ queue | Kafka / Redpanda | Implement `IProcessingQueue` with Kafka adapter |
| File-based collector output | Redis Streams / gRPC | Add new output adapter in collector, backend reads from new source |
| Isolation Forest | Deep learning, NLP, LLMs | Add new model classes behind `IAIClient`, deploy as additional endpoints |
| Single-tenant | Multi-tenant | Activate `orgId` in repositories, add tenant middleware, scope DB queries |
| Docker Compose | Kubernetes | Write Helm charts, split modules into deployable containers |
| PostgreSQL + MongoDB | ClickHouse + OpenSearch | Implement new repository adapters behind existing interfaces |

---

> **This ADR is the single source of truth for all architectural decisions in this project. All future documents, designs, and implementations must strictly conform to the decisions recorded here.**
>
> **Last Updated**: 2026-07-18
> **Next Review**: Upon major scope change or post-MVP planning
