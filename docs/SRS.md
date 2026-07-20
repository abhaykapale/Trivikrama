# Software Requirements Specification (SRS)

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | SRS-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-18 |
| **Status** | Draft |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Objectives](#2-project-objectives)
3. [Problem Statement](#3-problem-statement)
4. [System Scope](#4-system-scope)
5. [Out of Scope](#5-out-of-scope)
6. [Actors](#6-actors)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Use Cases](#9-use-cases)
10. [Assumptions](#10-assumptions)
11. [Constraints](#11-constraints)
12. [Success Criteria](#12-success-criteria)
13. [Risks](#13-risks)
14. [Future Scope](#14-future-scope)

---

## 1. Executive Summary

The AI-Powered Security Analytics Platform is a **Modular Monolith SIEM (Security Information and Event Management)** system that collects security logs from heterogeneous sources, normalizes them to the OCSF (Open Cybersecurity Schema Framework) standard, detects threats through both rule-based and AI-driven analysis, correlates related alerts into incidents, assigns risk scores, and presents actionable intelligence through a real-time SOC (Security Operations Center) analyst dashboard.

The platform is designed for **software engineering excellence** — built by a single engineer within 4–6 months, using Clean Architecture, SOLID principles, Repository Pattern, and Dependency Injection. It comprises four processes: a C++ log collector, a Node.js Express modular monolith backend, a Python FastAPI AI engine, and a Next.js analyst dashboard.

The system targets a **single organization** with a dedicated security operations team, with the architecture designed for future evolution toward multi-tenancy, advanced AI capabilities, and higher-throughput infrastructure.

---

## 2. Project Objectives

| # | Objective | Measurable Outcome |
|---|---|---|
| **O1** | Build a functional SIEM platform that ingests, normalizes, and stores security logs | Successfully ingest logs from ≥ 3 source types (syslog, file, Windows Event Log) and store them in OCSF format |
| **O2** | Implement rule-based threat detection with Sigma-compatible rules | Detect ≥ 10 common attack patterns (brute force, privilege escalation, lateral movement, etc.) using predefined Sigma rules |
| **O3** | Implement AI-driven anomaly detection with explainability | Isolation Forest model flags anomalous events with SHAP explanations; false positive rate < 15% on test data |
| **O4** | Provide real-time incident correlation and risk scoring | Related alerts are grouped into incidents within a configurable time window; risk scores reflect composite rule + ML + asset criticality |
| **O5** | Deliver a production-quality SOC analyst dashboard | Dashboard displays real-time incidents, supports investigation drill-down, rule management, and collector monitoring |
| **O6** | Demonstrate software engineering excellence | Clean Architecture enforced across all modules; ≥ 80% unit test coverage on domain and application layers; all data access behind repository interfaces |
| **O7** | Enable single-command deployment | Entire platform starts with `docker-compose up` — no manual configuration beyond environment variables |

---

## 3. Problem Statement

### Current State

Organizations face an overwhelming volume of security events from diverse sources — operating systems, network devices, firewalls, applications, cloud services. Security operations teams struggle with:

1. **Data Fragmentation**: Logs from different sources arrive in incompatible formats (syslog, JSON, CEF, LEEF, CSV, Windows Event Log XML), making unified analysis impossible without normalization.

2. **Alert Fatigue**: Traditional rule-based SIEM systems generate excessive alerts, many of which are false positives. Analysts spend more time triaging than investigating.

3. **Lack of Context**: Individual alerts without correlation fail to reveal the broader attack narrative. A brute force attempt, a successful login, and a privilege escalation — when viewed in isolation — look like three separate low-priority events. Correlated, they reveal a compromised account.

4. **No Explainability**: AI/ML-based detection systems operate as black boxes. When an ML model flags an event as anomalous, analysts cannot understand *why*, leading to distrust and disuse of AI capabilities.

5. **Operational Complexity**: Existing SIEM platforms (Splunk, QRadar, Elastic SIEM) require dedicated infrastructure teams, complex distributed systems expertise, and significant capital investment.

### Desired State

A **single-engineer-deployable** SIEM platform that:
- Normalizes all logs into OCSF for unified analysis
- Combines rule-based detection with explainable AI anomaly detection
- Correlates alerts into incidents with composite risk scoring
- Provides a modern, real-time SOC dashboard for analysts
- Runs entirely via `docker-compose up` — no distributed systems expertise required

---

## 4. System Scope

### 4.1 In-Scope Components

| Component | Description | Technology |
|---|---|---|
| **Log Collector** | Standalone binary that collects logs from multiple sources, converts to OCSF JSON, batches, and writes files atomically to a shared directory | C++ (C++20) |
| **Backend Monolith** | Single Express application with modular architecture: ingestion, parsing, normalization, feature extraction, rule engine, AI client, incident correlation, risk scoring, REST API, WebSocket | Node.js + Express + TypeScript |
| **AI Engine** | Stateless inference service: Isolation Forest anomaly detection, SHAP explainability, optional threat classification | Python + FastAPI |
| **SOC Dashboard** | Analyst-facing web application: real-time dashboard, incident management, log investigation, rule editor, collector monitoring, AI insights, audit log | Next.js (React + TypeScript) |
| **Data Layer** | PostgreSQL (relational), MongoDB (documents), Redis (cache/queue) | PostgreSQL, MongoDB, Redis |
| **Deployment** | Containerized deployment of all 4 processes + 3 databases | Docker Compose |

### 4.2 In-Scope Log Sources (MVP)

| Source | Protocol / Method | Platform |
|---|---|---|
| Syslog | UDP/TCP (RFC 5424) | Linux, network devices, firewalls |
| File Tailing | File system monitoring | Application logs (Apache, Nginx, custom apps) |
| Windows Event Log | ETW (Event Tracing for Windows) | Windows Server, Active Directory |
| JSON over HTTP | REST endpoint on collector | Cloud services, custom applications |

### 4.3 In-Scope Detection Capabilities (MVP)

| Type | Engine | Examples |
|---|---|---|
| **Rule-Based** | Sigma-compatible Rule Engine | Brute force detection, privilege escalation, suspicious process execution, known malware hashes, unauthorized access attempts |
| **AI-Based** | Isolation Forest + SHAP | Anomalous login times, unusual data transfer volumes, deviation from baseline network behavior, rare process execution patterns |
| **Correlation** | Incident Correlator | Kill chain stage mapping, entity-based grouping (user, host, IP), time-window aggregation |

---

## 5. Out of Scope

The following items are **explicitly excluded** from the MVP. They may be considered as future enhancements (see [Section 14](#14-future-scope)).

| # | Item | Reason for Exclusion |
|---|---|---|
| OS1 | **Multi-tenancy** | MVP targets single organization; architecture designed for future addition |
| OS2 | **Distributed message brokers** (Kafka, RabbitMQ, Pulsar) | Operational complexity exceeds single-engineer capacity |
| OS3 | **Container orchestration** (Kubernetes, ECS) | Docker Compose sufficient for MVP deployment |
| OS4 | **NLP-based log search** | Requires sentence transformers and significant training data |
| OS5 | **Log clustering** (DBSCAN/HDBSCAN) | Lower priority than core anomaly detection |
| OS6 | **LLM-based rule generation** | Requires LLM integration; future enhancement |
| OS7 | **Deep learning pipelines** (autoencoders, GNNs) | Isolation Forest provides sufficient MVP capability |
| OS8 | **Online/continual learning** | Models trained offline for MVP; online learning deferred |
| OS9 | **SOAR (Security Orchestration, Automation, Response)** | Automated response playbooks are a separate product concern |
| OS10 | **Threat intelligence feed integration** | External feed consumption (STIX/TAXII) deferred to post-MVP |
| OS11 | **Cloud-native deployment** (Terraform, Helm) | Exceeds MVP scope and single-engineer operational capacity |
| OS12 | **Mobile application** | Web dashboard sufficient for MVP |
| OS13 | **Email/SMS/Slack alerting** | Notification integrations deferred; dashboard-only alerting in MVP |
| OS14 | **Compliance reporting** (PCI-DSS, HIPAA, SOC 2) | Audit logging is in scope; formal compliance report generation is not |

---

## 6. Actors

| Actor | Description | Interaction |
|---|---|---|
| **SOC Analyst** | Primary user. Monitors dashboard, investigates incidents, triages alerts, searches logs, reviews AI explanations | Dashboard (Next.js) |
| **Security Engineer** | Creates and manages Sigma detection rules, configures data sources, tunes AI thresholds, reviews system health | Dashboard (Rules, Settings, Collector Monitoring pages) |
| **Administrator** | Manages users, roles, permissions, system configuration, retention policies | Dashboard (Settings, Audit Log pages) |
| **Collector Agent** | Non-human actor. The C++ binary that collects logs and writes to the collector directory | File system I/O |
| **AI Engine** | Non-human actor. The Python FastAPI service that performs ML inference when called by the backend | HTTP REST (called by Backend) |
| **External Log Sources** | Non-human actors. Systems that generate security logs: servers, firewalls, applications, network devices | Syslog, file output, HTTP, Windows ETW |

---

## 7. Functional Requirements

### FR-100: Log Collection

| ID | Requirement | Priority |
|---|---|---|
| FR-101 | The collector SHALL read logs from syslog sources over UDP and TCP (RFC 5424) | Must |
| FR-102 | The collector SHALL tail log files and detect new entries using file system monitoring | Must |
| FR-103 | The collector SHALL read Windows Event Logs via ETW (Event Tracing for Windows) | Must |
| FR-104 | The collector SHALL accept JSON-formatted logs via an HTTP endpoint | Should |
| FR-105 | The collector SHALL convert all collected logs to OCSF JSON format before writing | Must |
| FR-106 | The collector SHALL batch logs by configurable count (default: 1000) or time window (default: 5 seconds) | Must |
| FR-107 | The collector SHALL write batch files atomically (write to `.tmp`, rename to `.json`) to prevent partial reads | Must |
| FR-108 | The collector SHALL maintain checkpoints to resume collection after restart without data loss | Must |
| FR-109 | The collector SHALL write periodic heartbeat files containing health status, timestamp, and processing statistics | Must |
| FR-110 | The collector SHALL be configurable via a YAML configuration file | Must |

### FR-200: Log Ingestion & Processing Pipeline

| ID | Requirement | Priority |
|---|---|---|
| FR-201 | The backend SHALL watch the collector directory for new `.json` files using a file system watcher | Must |
| FR-202 | The backend SHALL enqueue detected files into an `IProcessingQueue` abstraction (implemented by BullMQ) | Must |
| FR-203 | Workers SHALL dequeue jobs from `IProcessingQueue` independently of the Directory Watcher | Must |
| FR-204 | Workers SHALL parse batch files and validate the OCSF JSON structure | Must |
| FR-205 | Workers SHALL validate normalized events against the OCSF schema and flag violations | Must |
| FR-206 | Workers SHALL extract statistical and contextual features from normalized events for detection | Must |
| FR-207 | Files that fail parsing SHALL be moved to a quarantine directory for manual inspection | Must |
| FR-208 | The `IProcessingQueue` SHALL support retry with configurable backoff for failed jobs | Must |
| FR-209 | The `IProcessingQueue` SHALL support dead-letter storage for permanently failed jobs | Must |
| FR-210 | The processing pipeline SHALL be resumable — no data loss on backend restart | Must |

### FR-300: Threat Detection

| ID | Requirement | Priority |
|---|---|---|
| FR-301 | The Rule Engine SHALL evaluate events against Sigma-compatible detection rules | Must |
| FR-302 | The Rule Engine SHALL support rule CRUD operations (create, read, update, delete) via the API | Must |
| FR-303 | The Rule Engine SHALL support enabling/disabling individual rules without deletion | Must |
| FR-304 | The Rule Engine SHALL support importing and exporting rules in YAML format | Should |
| FR-305 | The AI Engine SHALL detect anomalous events using an Isolation Forest model | Must |
| FR-306 | The AI Engine SHALL provide SHAP-based explanations for anomaly scores | Must |
| FR-307 | The AI Engine SHALL optionally classify threats by category using a supervised model (Random Forest/XGBoost) | Should |
| FR-308 | The backend SHALL call the AI Engine via HTTP with a configurable timeout | Must |
| FR-309 | If the AI Engine is unavailable or times out, the backend SHALL fall back to rule-only detection | Must |
| FR-310 | Detection results from both engines SHALL be merged and passed to the Incident Correlator | Must |

### FR-400: Incident Correlation & Risk Scoring

| ID | Requirement | Priority |
|---|---|---|
| FR-401 | The Incident Correlator SHALL group related alerts by entity (user, host, IP address) | Must |
| FR-402 | The Incident Correlator SHALL group alerts within a configurable time window (default: 15 minutes) | Must |
| FR-403 | The Incident Correlator SHALL map alerts to kill chain stages where applicable | Should |
| FR-404 | Uncorrelated alerts SHALL be stored as standalone incidents | Must |
| FR-405 | The Risk Scorer SHALL compute a composite score: `rule_weight × ML_confidence × asset_criticality` | Must |
| FR-406 | The Risk Scorer SHALL assign a severity level (Critical, High, Medium, Low, Informational) based on the composite score | Must |
| FR-407 | Risk scoring factors with missing values SHALL default to a neutral weight (1.0) | Must |

### FR-500: Incident Management

| ID | Requirement | Priority |
|---|---|---|
| FR-501 | The system SHALL store incidents in PostgreSQL with full lifecycle tracking | Must |
| FR-502 | Incidents SHALL support status transitions: Open → Investigating → Resolved → Closed | Must |
| FR-503 | Analysts SHALL be able to assign incidents to themselves or other users | Should |
| FR-504 | Analysts SHALL be able to add notes/comments to incidents | Should |
| FR-505 | Incidents SHALL be filterable by severity, status, source, time range, and assigned analyst | Must |
| FR-506 | Incidents SHALL be sortable by risk score, creation time, and last updated time | Must |
| FR-507 | Each incident SHALL link to its constituent alerts and the underlying normalized events | Must |

### FR-600: SOC Dashboard

| ID | Requirement | Priority |
|---|---|---|
| FR-601 | The dashboard SHALL display a real-time overview: total incidents, severity distribution, top affected assets, incident timeline | Must |
| FR-602 | The dashboard SHALL update in real-time via WebSocket (backed by Redis Pub/Sub) without requiring page refresh | Must |
| FR-603 | The dashboard SHALL provide an incident detail view with alert breakdown, OCSF event data, and AI explanations | Must |
| FR-604 | The dashboard SHALL provide a log search interface with filtering by time range, source, severity, and keyword | Must |
| FR-605 | The dashboard SHALL include a Sigma rule editor with YAML syntax highlighting | Should |
| FR-606 | The dashboard SHALL include rule testing capability (dry-run against historical events) | Should |
| FR-607 | The dashboard SHALL display AI model confidence scores and SHAP explanation visualizations | Must |

### FR-700: Collector Monitoring

| ID | Requirement | Priority |
|---|---|---|
| FR-701 | The dashboard SHALL display collector status: Online, Offline, or Degraded | Must |
| FR-702 | The dashboard SHALL display the timestamp of the last received heartbeat | Must |
| FR-703 | The dashboard SHALL display the count of files successfully processed by the backend | Must |
| FR-704 | The dashboard SHALL display the current queue size (jobs pending in `IProcessingQueue`) | Must |
| FR-705 | The dashboard SHALL display the count of failed/quarantined files | Must |
| FR-706 | The dashboard SHALL display collector resource usage (CPU, memory, disk) from heartbeat data | Should |
| FR-707 | The dashboard SHALL display the timestamp of the last batch processed by the backend | Must |

### FR-800: Authentication & Authorization

| ID | Requirement | Priority |
|---|---|---|
| FR-801 | The system SHALL require authentication for all API endpoints and dashboard pages | Must |
| FR-802 | The system SHALL support local username/password authentication with bcrypt hashing | Must |
| FR-803 | The system SHALL implement Role-Based Access Control (RBAC) with predefined roles: Admin, Security Engineer, SOC Analyst | Must |
| FR-804 | The system SHALL enforce role-based permissions on API endpoints (e.g., only Admin can manage users) | Must |
| FR-805 | The system SHALL use JWT tokens for session management, stored in Redis | Must |
| FR-806 | The system SHALL maintain an immutable audit log of all user actions (login, rule changes, incident updates) | Must |

### FR-900: Data Management

| ID | Requirement | Priority |
|---|---|---|
| FR-901 | Normalized events SHALL be stored in MongoDB with TTL indexes for automatic expiration | Must |
| FR-902 | Event retention period SHALL be configurable (default: 90 days) | Must |
| FR-903 | Incidents and audit logs SHALL be stored in PostgreSQL without automatic expiration | Must |
| FR-904 | The system SHALL support manual export of incidents and events (JSON/CSV) | Should |

---

## 8. Non-Functional Requirements

### NFR-100: Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-101 | End-to-end pipeline latency (file written → incident created) | < 30 seconds |
| NFR-102 | Collector throughput | ≥ 5,000 events/second sustained on a single core |
| NFR-103 | Backend processing throughput | ≥ 1,000 events/second with 4 concurrent workers |
| NFR-104 | AI Engine inference latency (anomaly detection) | < 200ms per batch (100 events) |
| NFR-105 | Dashboard page load time (initial SSR) | < 2 seconds |
| NFR-106 | REST API response time (95th percentile) | < 500ms |
| NFR-107 | WebSocket update latency (incident creation → dashboard display) | < 3 seconds |

### NFR-200: Reliability

| ID | Requirement | Target |
|---|---|---|
| NFR-201 | No data loss on backend restart | Processing queue is persistent (Redis AOF); unprocessed files remain in directory |
| NFR-202 | No data loss on collector restart | Checkpoints track read positions; collection resumes from last checkpoint |
| NFR-203 | AI Engine failure does not halt pipeline | Fallback to rule-only detection within 5 seconds of timeout |
| NFR-204 | Failed jobs are preserved | Dead-letter queue retains failed jobs for manual inspection and replay |

### NFR-300: Security

| ID | Requirement | Target |
|---|---|---|
| NFR-301 | All API endpoints require authentication | No unauthenticated access except `/health` and `/login` |
| NFR-302 | Passwords stored with bcrypt (cost factor ≥ 12) | OWASP password storage compliance |
| NFR-303 | JWT tokens expire after configurable duration (default: 8 hours) | Session timeout enforced |
| NFR-304 | All inter-process HTTP communication supports TLS | Configurable; enabled by default in production Docker Compose profile |
| NFR-305 | SQL injection prevention | Parameterized queries via ORM/query builder; no raw string concatenation |
| NFR-306 | Input validation on all API endpoints | Request body validation via schema (Joi/Zod); reject malformed requests |

### NFR-400: Scalability

| ID | Requirement | Target |
|---|---|---|
| NFR-401 | Backend supports configurable worker concurrency | 1–16 concurrent workers via environment variable |
| NFR-402 | MongoDB supports horizontal read scaling | Replica set configuration documented; not required for MVP |
| NFR-403 | Architecture supports future extraction to microservices | Module boundaries are service boundaries; `IProcessingQueue` and `IAIClient` are swappable |

### NFR-500: Maintainability

| ID | Requirement | Target |
|---|---|---|
| NFR-501 | Unit test coverage on domain and application layers | ≥ 80% |
| NFR-502 | Integration test coverage on repository implementations | ≥ 70% |
| NFR-503 | All modules follow Clean Architecture layer structure | Enforced via linting rules (import restrictions) |
| NFR-504 | All data access behind repository interfaces | Zero direct database calls in domain or application layers |
| NFR-505 | Consistent logging format across all backend modules | Structured JSON logging with correlation IDs |
| NFR-506 | API documented via OpenAPI 3.0 specification | Auto-generated from route definitions |

### NFR-600: Deployability

| ID | Requirement | Target |
|---|---|---|
| NFR-601 | Entire platform starts with `docker-compose up` | Single command deployment; no manual steps beyond `.env` configuration |
| NFR-602 | All configuration via environment variables | Twelve-Factor App methodology |
| NFR-603 | Database migrations run automatically on startup | Schema versioning via migration tool (Knex/Prisma for PG, Mongoose for MongoDB) |
| NFR-604 | Health check endpoints for all processes | `GET /health` on backend, AI engine; Docker health checks configured |

---

## 9. Use Cases

### UC-01: Ingest Logs from Syslog Source

| Field | Detail |
|---|---|
| **Actor** | Collector Agent, External Log Source |
| **Precondition** | Collector is running and configured with a syslog source on port 514 |
| **Main Flow** | 1. External device sends syslog message to collector on UDP/TCP port 514 → 2. Collector receives message, maps fields to OCSF JSON → 3. Collector accumulates events until batch threshold (1000 events or 5 seconds) → 4. Collector writes batch to `.tmp` file, renames to `.json` → 5. Collector updates checkpoint |
| **Postcondition** | Batch file exists in collector directory; checkpoint updated |
| **Exception** | Malformed syslog message → logged and skipped; disk full → collector logs error and pauses collection |

### UC-02: Process Batch File Through Pipeline

| Field | Detail |
|---|---|
| **Actor** | Backend (Directory Watcher, Workers) |
| **Precondition** | New `.json` file appears in collector directory |
| **Main Flow** | 1. Directory Watcher detects new file → 2. Watcher enqueues job in `IProcessingQueue` → 3. Worker dequeues job → 4. Worker reads batch file, parses JSON → 5. Worker validates each event against OCSF schema → 6. Worker extracts features → 7. Worker sends features to Rule Engine and AI Engine → 8. Worker passes detection results to Incident Correlator → 9. Correlator groups alerts, creates/updates incident → 10. Risk Scorer computes composite score → 11. Incident stored in PostgreSQL, events stored in MongoDB → 12. Real-time notification published via Redis Pub/Sub |
| **Postcondition** | Incidents created/updated in PostgreSQL; normalized events in MongoDB; dashboard updated via WebSocket |
| **Exception** | Parse failure → file moved to quarantine; AI Engine timeout → rule-only detection; Worker crash → job retried via `IProcessingQueue` |

### UC-03: Investigate an Incident

| Field | Detail |
|---|---|
| **Actor** | SOC Analyst |
| **Precondition** | Analyst is authenticated; incident exists in the system |
| **Main Flow** | 1. Analyst opens dashboard → sees real-time incident list → 2. Analyst clicks on high-risk incident → 3. System displays incident detail: constituent alerts, OCSF events, AI explanation (SHAP), risk score breakdown → 4. Analyst reviews SHAP explanation to understand why AI flagged this as anomalous → 5. Analyst changes incident status to "Investigating" → 6. Analyst adds investigation notes → 7. Analyst resolves or escalates incident |
| **Postcondition** | Incident status updated; analyst actions recorded in audit log |
| **Exception** | Session expired → redirect to login; incident modified by another user → optimistic locking conflict notification |

### UC-04: Create a Detection Rule

| Field | Detail |
|---|---|
| **Actor** | Security Engineer |
| **Precondition** | Engineer is authenticated with Security Engineer or Admin role |
| **Main Flow** | 1. Engineer navigates to Rules page → 2. Engineer clicks "Create Rule" → 3. Engineer writes Sigma-compatible rule in YAML editor → 4. Engineer tests rule against historical events (dry-run) → 5. Engineer saves rule with severity weight and description → 6. Rule Engine loads new rule on next evaluation cycle |
| **Postcondition** | New rule stored in PostgreSQL; active in Rule Engine; creation logged in audit trail |
| **Exception** | Invalid Sigma YAML → validation error displayed; duplicate rule name → conflict error |

### UC-05: Monitor Collector Health

| Field | Detail |
|---|---|
| **Actor** | Security Engineer, Administrator |
| **Precondition** | User is authenticated; collector is deployed |
| **Main Flow** | 1. User navigates to Collector Monitoring page → 2. System reads latest heartbeat data → 3. Dashboard displays: status (Online/Offline), last heartbeat time, files processed, queue size, failed files, collector resource usage, last batch processed → 4. If collector heartbeat is stale (> 2× heartbeat interval), status shows "Offline" |
| **Postcondition** | User has visibility into collector operational health |
| **Exception** | No heartbeat file exists → status shows "Unknown"; heartbeat data malformed → partial display with warning |

### UC-06: Review AI Explanation

| Field | Detail |
|---|---|
| **Actor** | SOC Analyst |
| **Precondition** | Incident was flagged by AI Engine; SHAP explanation is available |
| **Main Flow** | 1. Analyst opens incident flagged by AI → 2. Analyst navigates to "AI Insights" tab → 3. System displays: anomaly score, SHAP feature importance chart (which features contributed most to the anomaly score), model confidence level → 4. Analyst uses explanation to determine if the anomaly is a true positive or false positive → 5. Analyst marks incident accordingly |
| **Postcondition** | Analyst has understood the AI reasoning; incident triaged based on XAI evidence |
| **Exception** | SHAP explanation not available (AI Engine was down at detection time) → message: "AI explanation unavailable — detected by rules only" |

### UC-07: Manage Users and Roles

| Field | Detail |
|---|---|
| **Actor** | Administrator |
| **Precondition** | Admin is authenticated with Admin role |
| **Main Flow** | 1. Admin navigates to Settings → User Management → 2. Admin creates new user with username, password, and role (Admin, Security Engineer, SOC Analyst) → 3. System stores user with bcrypt-hashed password → 4. Admin can edit roles, disable accounts, or reset passwords |
| **Postcondition** | User account created/modified; action recorded in audit log |
| **Exception** | Duplicate username → conflict error; weak password → validation error (minimum 12 characters, complexity requirements) |

### UC-08: Search and Filter Logs

| Field | Detail |
|---|---|
| **Actor** | SOC Analyst |
| **Precondition** | Analyst is authenticated; normalized events exist in MongoDB |
| **Main Flow** | 1. Analyst navigates to Investigation page → 2. Analyst enters search criteria: time range, source type, severity, keyword → 3. System queries MongoDB with filters → 4. Results displayed in paginated table with OCSF field columns → 5. Analyst can click on any event to view full OCSF document → 6. Analyst can pivot from event to related incident |
| **Postcondition** | Analyst has located relevant events for investigation |
| **Exception** | Query returns zero results → "No events match your criteria" message; query timeout on large time range → suggest narrowing time window |

---

## 10. Assumptions

| # | Assumption | Impact if Invalid |
|---|---|---|
| **A1** | A single backend process (Node.js) can handle the expected event volume (≤ 1000 EPS with concurrent workers) | Architecture may need extraction of hot-path modules to separate processes |
| **A2** | File-based collector-to-backend communication provides sufficient throughput for the target deployment | May need to introduce Redis Streams or a queue-based ingestion path |
| **A3** | Isolation Forest is sufficient for MVP anomaly detection without deep learning | Detection quality may be lower for sophisticated attacks; addressed in future scope |
| **A4** | MongoDB text indexes provide adequate search capability without a dedicated search engine | May need to introduce OpenSearch/Elasticsearch for complex log queries |
| **A5** | The target organization generates ≤ 50GB of log data per day | Storage sizing, retention, and query performance assumptions are based on this volume |
| **A6** | The development team consists of a single engineer working full-time for 4–6 months | Timeline is based on this; additional scope requires either more time or more engineers |
| **A7** | Docker and Docker Compose are available in the target deployment environment | Deployment strategy depends entirely on Docker availability |
| **A8** | Log sources are accessible from the machine running the collector (network connectivity, permissions) | Collector cannot function if it cannot reach log sources |
| **A9** | OCSF schema covers ≥ 90% of fields needed for the target log sources | Remaining fields handled via documented extensions; extensive custom mappings would increase effort |
| **A10** | Analysts have modern web browsers (Chrome, Firefox, Edge — latest 2 versions) | Frontend compatibility is limited to modern browsers |

---

## 11. Constraints

| # | Constraint | Type | Source |
|---|---|---|---|
| **C1** | Architecture MUST be a Modular Monolith — no microservices | Architectural | ADR-001 (D1) |
| **C2** | All logs MUST be normalized to OCSF before entering the detection pipeline | Data | ADR-001 (D2) |
| **C3** | Languages: C++ (collector), Node.js/TypeScript (backend), Python (AI), Next.js/TypeScript (frontend) | Technical | ADR-001 (D3) |
| **C4** | Databases: PostgreSQL, MongoDB, Redis only | Technical | ADR-001 (D4) |
| **C5** | No distributed message brokers (Kafka, RabbitMQ, Pulsar) | Architectural | ADR-001 (D5) |
| **C6** | No container orchestration (Kubernetes), no IaC (Terraform), no ML platforms (MLflow, Ray) | Operational | ADR-001 (D5, D9, D10) |
| **C7** | Single-tenant only for MVP | Scope | ADR-001 (D8) |
| **C8** | Collector MUST NOT perform parsing, detection, AI inference, incident generation, or database operations | Architectural | ADR-001 (Section 5) |
| **C9** | Processing queue MUST be behind `IProcessingQueue` interface — no direct BullMQ coupling in business logic | Design | ADR-001 (Section 6) |
| **C10** | Deployment via Docker Compose only | Operational | ADR-001 (D10) |
| **C11** | Clean Architecture, SOLID, Repository Pattern, Dependency Injection enforced across all backend modules | Design | ADR-001 (Section 4) |
| **C12** | AI MVP limited to Isolation Forest + SHAP + optional threat classification | Scope | ADR-001 (Section 7) |
| **C13** | Development timeline: 4–6 months, single engineer | Resource | Project scope |

---

## 12. Success Criteria

| # | Criterion | Verification Method |
|---|---|---|
| **SC1** | Collector successfully ingests logs from ≥ 3 source types and writes valid OCSF JSON batches | Integration test: ingest syslog, file tail, and simulated Windows Event Log; validate output against OCSF schema |
| **SC2** | Backend processes batch files end-to-end: parse → normalize → detect → correlate → score → store | End-to-end test: drop a test batch in collector directory; verify incident appears in PostgreSQL within 30 seconds |
| **SC3** | Rule Engine correctly fires on ≥ 10 Sigma rules against test data | Unit tests: 10+ Sigma rules with known true-positive and true-negative test events |
| **SC4** | AI Engine returns anomaly scores with SHAP explanations within 200ms for a batch of 100 events | Performance test: benchmark anomaly endpoint with 100-event batches; measure p95 latency |
| **SC5** | Dashboard displays real-time incidents within 3 seconds of creation | Manual verification: create incident, observe dashboard update via WebSocket |
| **SC6** | Collector Monitoring page accurately reflects collector status | Manual verification: stop collector, verify dashboard shows "Offline" within 2× heartbeat interval |
| **SC7** | AI Engine fallback works — pipeline continues with rule-only detection when AI is unavailable | Integration test: stop AI Engine, drop test batch, verify incident created with rule-only alerts |
| **SC8** | Entire platform starts with `docker-compose up` and is functional within 60 seconds | Deployment test: fresh `docker-compose up` from clean state; verify all health checks pass |
| **SC9** | Unit test coverage ≥ 80% on domain and application layers | CI pipeline coverage report |
| **SC10** | All data access is behind repository interfaces — zero direct DB calls in domain/application layers | Code review + architectural fitness function (import restriction linting) |

---

## 13. Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | Single backend process cannot handle event volume | Medium | 🟡 High | BullMQ concurrency tuning (1–16 workers); async I/O; worker threads for CPU-bound tasks |
| **R2** | C++ collector has memory safety vulnerabilities | Medium | 🔴 Critical | C++20 smart pointers; AddressSanitizer + UBSan in CI; fuzzing with libFuzzer |
| **R3** | AI Engine latency degrades pipeline throughput | Medium | 🟡 High | Configurable timeout with rule-only fallback; batch prediction; async HTTP calls |
| **R4** | MongoDB storage grows beyond available disk | High | 🟡 High | TTL indexes with configurable retention; monitoring + alerting; archival strategy |
| **R5** | Scope creep extends timeline beyond 6 months | High | 🟠 Medium | Strict MVP scope enforcement; phased delivery milestones; weekly scope reviews |
| **R6** | OCSF schema does not cover important log fields | Medium | 🟠 Medium | Documented extension policy (D2); tracked in `ocsf-extensions.md`; never create custom schema |
| **R7** | Isolation Forest produces high false positive rate | Medium | 🟡 High | SHAP explanations for analyst review; configurable confidence thresholds; analyst feedback for model retraining |
| **R8** | File-based communication creates bottleneck under burst load | Low | 🟠 Medium | Collector ring buffer; configurable batch size; upgrade path to Redis queue via `IProcessingQueue` |
| **R9** | Single engineer bus factor | High | 🔴 Critical | Comprehensive documentation; clean code; high test coverage; ADR-001 as architectural truth |
| **R10** | Docker Compose not suitable for production-scale deployment | Low | 🟠 Medium | Sufficient for MVP; Kubernetes migration path documented in ADR-001 future evolution |

---

## 14. Future Scope

The following enhancements are planned for post-MVP phases. The architecture (ADR-001) is designed to accommodate each of these without architectural rewrites.

### Phase 2 — Enhanced AI

| Feature | Description | Migration Path |
|---|---|---|
| NLP-based log search | Natural language queries over log data | New endpoint in AI Engine; frontend search bar integration |
| Log clustering | DBSCAN/HDBSCAN for grouping similar events | New endpoint in AI Engine; new dashboard visualization |
| Online learning | Model updates from analyst feedback | Feedback API in backend; retraining pipeline in AI notebooks |
| Deep learning | Autoencoders, graph neural networks | New model classes behind `IAIClient` interface |

### Phase 3 — Scale & Multi-Tenancy

| Feature | Description | Migration Path |
|---|---|---|
| Multi-tenancy | Tenant isolation, management, tenant-aware data | Activate `orgId` in repositories; add tenant middleware; scope queries |
| Kafka/Redpanda | High-throughput message bus | Implement `IProcessingQueue` with Kafka adapter |
| Kubernetes | Container orchestration | Write Helm charts; split modules into containers |
| ClickHouse | Analytical storage for high-volume queries | New repository implementations behind existing interfaces |

### Phase 4 — Enterprise Features

| Feature | Description | Migration Path |
|---|---|---|
| SOAR integration | Automated response playbooks | New module in backend; webhook-based action triggers |
| Threat intel feeds | STIX/TAXII feed consumption | New enrichment source in backend enrichment module |
| LLM-based rule generation | AI-assisted Sigma rule creation | New AI Engine endpoint; frontend rule suggestion UI |
| Compliance reporting | PCI-DSS, HIPAA, SOC 2 report generation | New reporting module; scheduled report jobs |
| Email/SMS/Slack alerting | Multi-channel notification delivery | Notification adapter pattern in Alert module |
| SSO (OIDC/SAML) | Enterprise single sign-on | Swap authentication strategy in Auth module |

---

> **This SRS is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). All requirements, scope decisions, and constraints are consistent with the frozen architectural decisions.**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-18
> **Next Review**: Upon scope change or milestone completion
