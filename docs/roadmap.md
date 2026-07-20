# Implementation Roadmap

| Field | Value |
|---|---|
| **Document ID** | ROADMAP-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-19 |
| **Role** | Technical Lead |

This document outlines the week-by-week implementation roadmap for the AI-Powered Security Analytics Platform, built under the constraints of a single-engineer Modular Monolith (ADR-001). 

The milestones are ordered progressively from **easiest (foundational)** to **hardest (complex integrations and tuning)**.

---

## Week 1: Foundation & Security (Easiest)

### Milestone 1: Project Scaffolding & Infrastructure
* **Tasks:**
  * Initialize monorepo directory structure (`backend/`, `frontend/`, `ai-engine/`, `collector/`).
  * Create `docker-compose.dev.yml` for local PostgreSQL, MongoDB, and Redis.
  * Write initial SQL schemas and MongoDB index scripts.
* **Dependencies:** None.
* **Testing:** Run `docker-compose up` and verify all databases accept connections using CLI clients.

### Milestone 2: Backend Core & Authentication
* **Tasks:**
  * Initialize Node.js/Express backend with TypeScript.
  * Implement PostgreSQL (Knex.js) and MongoDB (Mongoose) connections.
  * Implement User management API, JWT generation, and `siem_token` HttpOnly cookie middleware.
* **Dependencies:** Milestone 1 (Databases).
* **Testing:** Use Postman/Jest to verify successful login, invalid credential rejection, and protected route access.

---

## Week 2: Data Acquisition & Queueing

### Milestone 3: C++ Collector (Agent)
* **Tasks:**
  * Set up CMake project for C++ collector.
  * Implement file reading, basic CSV/JSON parsing, and conversion to basic OCSF JSON format.
  * Implement atomic writes (writing to `.tmp` then renaming to `.json`).
* **Dependencies:** None (standalone binary).
* **Testing:** Feed a 100MB sample log file; verify it outputs valid, batched OCSF `.json` files to the output directory without data loss.

### Milestone 4: Backend Ingestion & BullMQ
* **Tasks:**
  * Implement `ChokidarDirectoryWatcher` to detect new `.json` files.
  * Configure Redis BullMQ and implement the `IProcessingQueue`.
  * Set up the PM2 background worker structure to consume queue jobs.
* **Dependencies:** Milestone 2 (Backend Core), Milestone 3 (for test data).
* **Testing:** Drop `.json` files into the watched folder and verify BullMQ workers log successful job consumption.

---

## Week 3: Data Processing & Rule Engine

### Milestone 5: Normalization & Feature Extraction
* **Tasks:**
  * Implement the Pipeline orchestrator.
  * Build the `OCSFNormalizer` schema validator.
  * Implement `FeatureExtractor` plugins (Temporal, Frequency, Authentication).
  * Save normalized events to MongoDB `normalized_events` collection.
* **Dependencies:** Milestone 4 (Queue workers).
* **Testing:** Run a batch job; query MongoDB to ensure events are stored with correctly extracted ML features and OCSF compliance.

### Milestone 6: Detection Engine (Rule-based)
* **Tasks:**
  * Implement Sigma-compatible rule parser.
  * Implement the in-memory matching engine (evaluating MongoDB documents against active rules).
  * Generate `Alert` records in PostgreSQL on match.
* **Dependencies:** Milestone 5 (Normalized events).
* **Testing:** Create a mock SSH Brute Force rule, feed matching events, and verify PostgreSQL `alerts` table populates correctly.

---

## Week 4: AI Engine Integration (Moderate)

### Milestone 7: Python AI Engine
* **Tasks:**
  * Initialize FastAPI Python service.
  * Implement Isolation Forest model loading and inference (`/detect/anomaly`).
  * Implement SHAP explanation generator.
  * Integrate Node.js Backend to call AI Engine over internal HTTP during the pipeline.
* **Dependencies:** Milestone 5 (Extracted features).
* **Testing:** Send a batch of normal and anomalous feature arrays to FastAPI; verify the backend correctly receives anomaly scores and SHAP values.

---

## Week 5: Alert Correlation (Hard)

### Milestone 8: Incident Management
* **Tasks:**
  * Implement the `IncidentCorrelator` worker.
  * Group alerts by Entity (IP/User) and Time Window (e.g., 15 mins).
  * Calculate dynamic risk scores (Formula combining rule weights + anomaly scores).
  * Expose Incident CRUD APIs (`GET /incidents`, `PUT /incidents/:id/status`).
* **Dependencies:** Milestone 6 (Rule Alerts), Milestone 7 (AI Alerts).
* **Testing:** Trigger 5 different alerts for the same Source IP within 5 minutes; verify they are merged into a single High-Severity Incident in PostgreSQL.

---

## Week 6: User Interface (Moderate-Hard)

### Milestone 9: Frontend MVP & WebSockets
* **Tasks:**
  * Initialize Next.js frontend with Tailwind CSS/shadcn-ui.
  * Build Authentication UI and RBAC route protection.
  * Build the Incident Dashboard and Event Investigation views.
  * Implement WebSocket client/server for real-time alert notifications.
* **Dependencies:** Milestone 2 (Auth), Milestone 8 (APIs).
* **Testing:** Log in via browser, trigger an alert via backend script, and verify the UI updates instantly without a page refresh.

---

## Week 7: System Hardening & Performance (Hardest)

### Milestone 10: E2E Testing, Scaling, & Tuning
* **Tasks:**
  * Load testing: Simulate 2,000 EPS (Events Per Second).
  * Tune PM2 worker concurrency and BullMQ concurrency limits.
  * Tune MongoDB and PostgreSQL connection pools.
  * Fix memory leaks and optimize C++ batching sizes.
* **Dependencies:** Milestones 1-9 (Complete System).
* **Testing:** Run a 24-hour soak test at 2,000 EPS. Verify CPU/Memory remain stable, no queue backups occur, and search queries return in < 1 second.
