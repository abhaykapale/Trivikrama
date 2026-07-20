# Backend Design — Detection & Response Pipeline

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | BACKEND-002 |
| **Version** | 1.0 |
| **Date** | 2026-07-18 |
| **Status** | Draft |
| **Language** | Node.js + Express + TypeScript |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |
| **HLD Reference** | [HLD-001](file:///d:/AI%20SIEM/docs/HLD.md) |
| **Pipeline Part 1** | [BACKEND-001 - Ingestion & Processing](file:///d:/AI%20SIEM/docs/backend.md) |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Rule Engine](#2-rule-engine)
3. [AI Client](#3-ai-client)
4. [Incident Correlation](#4-incident-correlation)
5. [Risk Scoring](#5-risk-scoring)
6. [Detection Output & Storage](#6-detection-output--storage)

---

## 1. Overview

### 1.1 Pipeline Position

This document covers the **detection and response pipeline** — the second half of the worker pipeline. It receives feature-enriched events from BACKEND-001 and produces scored incidents stored in the database.

```mermaid
flowchart LR
    subgraph PART1["BACKEND-001<br/>Ingestion and Processing"]
        DW["Directory<br/>Watcher"]
        PQ{{"IProcessingQueue"}}
        WRK["Workers"]
        VAL["Validator"]
        PAR["Parser"]
        NOR["Normalizer"]
        FEX["Feature<br/>Extractor"]
    end

    subgraph PART2["BACKEND-002<br/>Detection and Response"]
        RE["Rule<br/>Engine"]
        AIC["AI<br/>Client"]
        IC["Incident<br/>Correlator"]
        RS["Risk<br/>Scorer"]
    end

    subgraph STORAGE["Storage"]
        PG[("PostgreSQL")]
        MDB[("MongoDB")]
        RD[("Redis<br/>Pub/Sub")]
    end

    DW --> PQ --> WRK --> VAL --> PAR --> NOR --> FEX
    FEX --> RE
    FEX --> AIC
    RE --> IC
    AIC --> IC
    IC --> RS
    RS --> PG
    RS --> MDB
    RS --> RD

    style PART1 fill:#2c3e50,color:#fff
    style PART2 fill:#8e44ad,color:#fff
    style PG fill:#27ae60,color:#fff
    style MDB fill:#27ae60,color:#fff
```

### 1.2 Component Diagram

```mermaid
graph TB
    subgraph DRP["Detection and Response Pipeline"]

        subgraph ANALYSIS["Analysis Module"]
            IRE{{"IRuleEngine"}}
            SIGMA["SigmaRuleEngine<br/>(implements IRuleEngine)"]
            RSTORE["RuleStore<br/>(loads rules from PostgreSQL)"]

            IAIC{{"IAIClient"}}
            HAIC["HttpAIClient<br/>(implements IAIClient)"]
            FBACK["FallbackHandler<br/>(rule-only on AI timeout)"]
        end

        subgraph CORRELATION["Correlation Module"]
            ICOR{{"IIncidentCorrelator"}}
            ECOR["EntityCorrelator<br/>(implements IIncidentCorrelator)"]
            TWINDOW["TimeWindowManager<br/>(configurable window)"]
            KCMAP["KillChainMapper<br/>(optional MITRE ATT&CK)"]

            IRS{{"IRiskScorer"}}
            CRS["CompositeRiskScorer<br/>(implements IRiskScorer)"]
            SEV["SeverityClassifier<br/>(score to severity level)"]
        end

        subgraph PERSIST["Persistence"]
            IINC{{"IIncidentRepository"}}
            ILOG{{"ILogRepository"}}
            IAUD{{"IAuditRepository"}}
            NOTIFY["NotificationPublisher<br/>(Redis Pub/Sub)"]
        end
    end

    FEX_IN["FeatureEnrichedEvents<br/>(from BACKEND-001)"]

    FEX_IN --> IRE
    FEX_IN --> IAIC
    IRE --> SIGMA --> RSTORE
    IAIC --> HAIC --> FBACK
    SIGMA --> ICOR
    HAIC --> ICOR
    ICOR --> ECOR
    ECOR --> TWINDOW
    ECOR --> KCMAP
    ECOR --> IRS
    IRS --> CRS --> SEV
    CRS --> IINC
    CRS --> ILOG
    CRS --> IAUD
    CRS --> NOTIFY

    style IRE fill:#3498db,color:#fff
    style IAIC fill:#3498db,color:#fff
    style ICOR fill:#3498db,color:#fff
    style IRS fill:#3498db,color:#fff
    style IINC fill:#3498db,color:#fff
    style ILOG fill:#3498db,color:#fff
    style IAUD fill:#3498db,color:#fff
```

---

## 2. Rule Engine

### 2.1 Component Diagram

```mermaid
graph TB
    subgraph REC["Rule Engine Component"]
        IRE2{{"IRuleEngine"}}

        subgraph SIGMA_ENGINE["SigmaRuleEngine"]
            LOADER["RuleLoader<br/>Load from PostgreSQL<br/>Cache in memory"]
            COMPILER["RuleCompiler<br/>Sigma YAML to executable<br/>condition functions"]
            EVALUATOR["RuleEvaluator<br/>Match events against<br/>compiled conditions"]
            RESULT["AlertBuilder<br/>Build alert objects<br/>from matches"]
        end

        subgraph RULE_STORE["RuleStore (PostgreSQL)"]
            RCRUD["Rule CRUD<br/>Create/Read/Update/Delete"]
            RVERSION["Rule Versioning<br/>Track changes"]
            RENABLE["Enable/Disable<br/>Toggle without delete"]
        end

        subgraph RULE_TYPES["Supported Rule Types"]
            RT_MATCH["Match Rules<br/>Single event match"]
            RT_COUNT["Count Rules<br/>Threshold over time window"]
            RT_SEQ["Sequence Rules<br/>Ordered event sequence"]
        end
    end

    FEX_R["FeatureEnrichedEvent[]"]
    ALERTS_OUT["Alert[]"]

    FEX_R --> EVALUATOR
    LOADER --> COMPILER
    EVALUATOR --> RESULT
    RESULT --> ALERTS_OUT

    style IRE2 fill:#3498db,color:#fff
    style ALERTS_OUT fill:#e74c3c,color:#fff
```

### 2.2 IRuleEngine Interface

```typescript
// Domain Layer - modules/analysis/domain/IRuleEngine.ts

interface IRuleEngine {
  /**
   * Evaluate a batch of events against all active rules.
   * Returns alerts for all matching rules.
   */
  evaluate(events: FeatureEnrichedEvent[]): Promise<RuleEvaluationResult>;

  /**
   * Reload rules from the store (called on rule CRUD).
   */
  reloadRules(): Promise<void>;

  /**
   * Get engine stats.
   */
  getStats(): RuleEngineStats;
}

interface RuleEvaluationResult {
  alerts: RuleAlert[];
  stats: EvaluationStats;
}

interface RuleAlert {
  alertId: string;            // UUID v4
  ruleId: string;             // ID of the matched rule
  ruleName: string;           // Human-readable rule name
  ruleDescription: string;
  severity: RuleSeverity;     // Rule-defined severity
  weight: number;             // Rule weight for risk scoring (0.0 - 1.0)
  matchedEvents: string[];    // IDs of events that triggered this rule
  matchedCondition: string;   // Which condition matched
  tags: string[];             // MITRE ATT&CK tags, custom tags
  timestamp: Date;            // When the alert was generated
  metadata: Record<string, any>; // Additional rule-specific data
}

type RuleSeverity = "critical" | "high" | "medium" | "low" | "informational";

interface EvaluationStats {
  rulesEvaluated: number;
  rulesMatched: number;
  alertsGenerated: number;
  evaluationDuration_ms: number;
  eventsEvaluated: number;
}

interface RuleEngineStats {
  totalRules: number;
  activeRules: number;
  disabledRules: number;
  lastReloadAt: Date;
  rulesByType: Record<string, number>;
}
```

### 2.3 Sigma Rule Structure

Rules are stored in PostgreSQL as YAML and compiled into executable conditions at load time.

```yaml
# Example: Brute Force Detection Rule
title: SSH Brute Force Attempt
id: rule-bf-ssh-001
description: >
  Detects multiple failed SSH login attempts from the same
  source IP within a short time window.
status: active
level: high
weight: 0.8

# OCSF class filter
logsource:
  class_uid: 3002        # Authentication
  category_uid: 3         # Identity & Access Management

# Detection condition
detection:
  selection:
    message|contains: "Failed password"
    severityId: 3

  condition:
    type: count
    field: srcEndpoint.ip
    threshold: 10
    timewindow: 5m

# Metadata
tags:
  - attack.credential_access
  - attack.t1110
  - mitre.brute_force

falsepositives:
  - Legitimate password reset attempts
  - Automated testing
```

### 2.4 Rule Types

```mermaid
graph LR
    subgraph TYPES["Rule Types"]
        MATCH["Match Rule<br/>Single event matches<br/>a condition"]
        COUNT["Count Rule<br/>N events match condition<br/>within time window"]
        SEQ["Sequence Rule<br/>Events match in order<br/>within time window"]
    end

    subgraph MATCH_EX["Match Example"]
        M1["Event has severity=critical<br/>AND message contains 'audit log cleared'"]
    end

    subgraph COUNT_EX["Count Example"]
        C1["10+ failed logins<br/>from same src_ip<br/>within 5 minutes"]
    end

    subgraph SEQ_EX["Sequence Example"]
        S1["1. Failed login<br/>2. Successful login<br/>3. Privilege escalation<br/>Same user, within 10 min"]
    end

    MATCH --> M1
    COUNT --> C1
    SEQ --> S1
```

| Type | Condition | State Required | MVP Status |
|---|---|---|---|
| **Match** | Single event matches field conditions | Stateless | ✅ MVP |
| **Count** | N events match condition within time window | Redis counter (rolling window) | ✅ MVP |
| **Sequence** | Ordered events within time window | Redis sorted set (event sequence tracking) | ⏳ Post-MVP |

### 2.5 Rule Compilation

On startup and after any rule CRUD operation, the Rule Engine compiles Sigma YAML into executable JavaScript condition functions:

```mermaid
flowchart TD
    YAML["Sigma YAML<br/>(from PostgreSQL)"]
    PARSE["Parse YAML<br/>(js-yaml)"]
    VALIDATE["Validate structure<br/>(required fields, valid types)"]
    COMPILE["Compile condition<br/>to JavaScript function"]
    CACHE_R["Cache compiled rule<br/>in memory"]
    READY["Rule ready for evaluation"]

    YAML --> PARSE --> VALIDATE --> COMPILE --> CACHE_R --> READY

    VALIDATE -->|"invalid"| REJECT["Log error<br/>Skip rule<br/>Increment rules_failed counter"]

    style READY fill:#27ae60,color:#fff
    style REJECT fill:#e74c3c,color:#fff
```

### 2.6 Rule Evaluation Flow

```mermaid
flowchart TD
    EVENTS["FeatureEnrichedEvent[]"]
    LOOP["For each active rule"]
    CLASS_FILTER{"Event class_uid<br/>matches rule<br/>logsource?"}
    FIELD_MATCH{"Fields match<br/>selection<br/>criteria?"}
    COND_TYPE{"Condition<br/>type?"}

    MATCH_EXEC["Direct match<br/>→ Generate alert"]
    COUNT_CHECK["Increment Redis counter<br/>Check threshold"]
    COUNT_HIT{"Count >=<br/>threshold?"}
    COUNT_ALERT["Generate count alert"]

    COLLECT["Collect all alerts"]
    OUTPUT_A["RuleEvaluationResult<br/>{alerts[], stats}"]

    EVENTS --> LOOP
    LOOP --> CLASS_FILTER
    CLASS_FILTER -->|"no"| LOOP
    CLASS_FILTER -->|"yes"| FIELD_MATCH
    FIELD_MATCH -->|"no"| LOOP
    FIELD_MATCH -->|"yes"| COND_TYPE
    COND_TYPE -->|"match"| MATCH_EXEC --> COLLECT
    COND_TYPE -->|"count"| COUNT_CHECK --> COUNT_HIT
    COUNT_HIT -->|"yes"| COUNT_ALERT --> COLLECT
    COUNT_HIT -->|"no"| LOOP
    COLLECT --> OUTPUT_A

    style OUTPUT_A fill:#e74c3c,color:#fff
```

### 2.7 Rule Management API (Exposed via REST)

| Operation | Handler | Description |
|---|---|---|
| `GET /api/v1/rules` | `RuleController.list()` | List all rules (paginated, filterable by status/severity/tag) |
| `GET /api/v1/rules/:id` | `RuleController.getById()` | Get single rule with YAML content |
| `POST /api/v1/rules` | `RuleController.create()` | Create new rule from YAML; compile and validate |
| `PUT /api/v1/rules/:id` | `RuleController.update()` | Update rule YAML; recompile |
| `DELETE /api/v1/rules/:id` | `RuleController.delete()` | Soft-delete rule (archived, not destroyed) |
| `PUT /api/v1/rules/:id/enable` | `RuleController.enable()` | Activate rule in engine |
| `PUT /api/v1/rules/:id/disable` | `RuleController.disable()` | Deactivate without deleting |
| `POST /api/v1/rules/:id/test` | `RuleController.test()` | Dry-run against historical events |
| `POST /api/v1/rules/import` | `RuleController.import()` | Bulk import YAML rules |
| `GET /api/v1/rules/export` | `RuleController.export()` | Export all rules as YAML archive |

### 2.8 Preloaded Rule Set (MVP)

The MVP ships with 10+ built-in Sigma rules:

| Rule | Class | Type | Detects |
|---|---|---|---|
| SSH Brute Force | Authentication | Count | 10+ failed SSH logins from same IP in 5 min |
| RDP Brute Force | Authentication | Count | 10+ failed RDP logins from same IP in 5 min |
| Successful Login After Failures | Authentication | Sequence | Failed logins followed by success (same user) |
| New Service Installed | System Activity | Match | Windows Event 7045 — new service installation |
| Audit Log Cleared | System Activity | Match | Windows Event 1102 or `/var/log` cleared |
| Privilege Escalation | Authorization | Match | Special privileges assigned (Event 4672) |
| Suspicious Process Execution | Process Activity | Match | Known malicious process names (mimikatz, nc, etc.) |
| Unusual Login Time | Authentication | Match | Login outside business hours + high time_deviation_score |
| High Data Transfer | Network Activity | Match | bytes_sent > threshold from internal to external |
| Multiple Account Lockouts | Authentication | Count | 5+ lockout events in 10 min |

---

## 3. AI Client

### 3.1 Component Diagram

```mermaid
graph TB
    subgraph AICC["AI Client Component"]
        IAIC2{{"IAIClient"}}

        subgraph HTTP_CLIENT["HttpAIClient"]
            REQ_BUILD["Request Builder<br/>Convert FeatureVector<br/>to AI API request"]
            HTTP_CALL["HTTP Client<br/>(axios)"]
            RESP_PARSE["Response Parser<br/>Parse anomaly scores<br/>+ SHAP values"]
            TIMEOUT["Timeout Handler<br/>(configurable, default 5s)"]
        end

        subgraph FALLBACK["Fallback Strategy"]
            FB_DETECT["FallbackDetector<br/>Monitor AI health"]
            FB_HANDLER["FallbackHandler<br/>Return neutral scores<br/>when AI unavailable"]
            CB["Circuit Breaker<br/>Open after N failures<br/>Half-open after cooldown"]
        end

        subgraph BATCH_OPT["Batch Optimization"]
            BATCH_B["BatchBuilder<br/>Group events for<br/>single HTTP call"]
            SPLIT["Response Splitter<br/>Map results back<br/>to individual events"]
        end
    end

    FEX_AI["FeatureEnrichedEvent[]"]
    AI_EXT["Python FastAPI<br/>AI Engine"]
    AI_ALERTS["AIAlert[]"]

    FEX_AI --> REQ_BUILD
    REQ_BUILD --> BATCH_B
    BATCH_B --> HTTP_CALL
    HTTP_CALL -->|"POST /api/v1/detect/anomaly"| AI_EXT
    AI_EXT -->|"JSON response"| RESP_PARSE
    RESP_PARSE --> SPLIT
    SPLIT --> AI_ALERTS

    HTTP_CALL -->|"timeout / error"| TIMEOUT
    TIMEOUT --> FB_DETECT
    FB_DETECT --> CB
    CB -->|"circuit open"| FB_HANDLER
    FB_HANDLER --> AI_ALERTS

    style IAIC2 fill:#3498db,color:#fff
    style AI_EXT fill:#f39c12,color:#fff
```

### 3.2 IAIClient Interface

```typescript
// Domain Layer - modules/analysis/domain/IAIClient.ts

interface IAIClient {
  /**
   * Send events to AI Engine for anomaly detection.
   * Returns AI-generated alerts with anomaly scores and SHAP explanations.
   */
  detect(events: FeatureEnrichedEvent[]): Promise<AIDetectionResult>;

  /**
   * Request SHAP explanation for a specific event.
   */
  explain(event: FeatureEnrichedEvent): Promise<AIExplanation>;

  /**
   * Check AI Engine health.
   */
  healthCheck(): Promise<AIHealthStatus>;

  /**
   * Get client stats (latency, errors, circuit state).
   */
  getStats(): AIClientStats;
}

interface AIDetectionResult {
  alerts: AIAlert[];
  stats: AIDetectionStats;
}

interface AIAlert {
  alertId: string;
  eventId: string;             // ID of the event that triggered this alert
  anomalyScore: number;        // 0.0 (normal) to 1.0 (highly anomalous)
  isAnomaly: boolean;          // anomalyScore > threshold
  confidence: number;          // Model confidence (0.0 - 1.0)
  threatCategory: string | null; // Optional classification result
  shapValues: SHAPExplanation | null;
  modelVersion: string;
  timestamp: Date;
}

interface SHAPExplanation {
  baseValue: number;           // Expected model output
  features: SHAPFeature[];     // Feature contributions, sorted by abs(value)
}

interface SHAPFeature {
  name: string;                // Feature name (e.g., "frequency.events_per_minute_src_ip")
  value: number;               // Actual feature value
  shapValue: number;           // SHAP contribution (positive = pushes toward anomaly)
}

interface AIDetectionStats {
  eventsSubmitted: number;
  anomaliesDetected: number;
  requestDuration_ms: number;
  usedFallback: boolean;
}

interface AIClientStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbacksUsed: number;
  avgLatency_ms: number;
  circuitState: "closed" | "open" | "half-open";
  lastHealthCheck: Date | null;
}
```

### 3.3 Request/Response Flow

```mermaid
sequenceDiagram
    participant W as PipelineWorker
    participant AC as HttpAIClient
    participant CB as CircuitBreaker
    participant AI as Python FastAPI

    W->>AC: detect(featureEnrichedEvents)
    AC->>AC: Build request batch<br/>(extract feature vectors)
    AC->>CB: canExecute()?

    alt Circuit CLOSED (normal)
        CB-->>AC: yes
        AC->>AI: POST /api/v1/detect/anomaly<br/>{features: [...], threshold: 0.65}
        
        alt AI responds in time
            AI-->>AC: 200 OK<br/>{predictions: [{score, isAnomaly, shapValues}]}
            AC->>AC: Parse response<br/>Build AIAlert objects
            AC->>CB: reportSuccess()
            AC-->>W: AIDetectionResult {alerts, stats}
        else AI times out (> 5s)
            AC->>CB: reportFailure()
            AC->>AC: FallbackHandler<br/>Return neutral scores
            AC-->>W: AIDetectionResult {alerts: [], stats: {usedFallback: true}}
        end

    else Circuit OPEN (AI unhealthy)
        CB-->>AC: no (circuit open)
        AC->>AC: Skip HTTP call entirely<br/>Use FallbackHandler
        AC-->>W: AIDetectionResult {alerts: [], stats: {usedFallback: true}}
        
        Note over CB: After cooldown (60s),<br/>circuit moves to HALF-OPEN<br/>and allows one test request
    end
```

### 3.4 Circuit Breaker Configuration

| Setting | Default | Description |
|---|---|---|
| `ai.timeout_ms` | `5000` | HTTP request timeout |
| `ai.circuit_failure_threshold` | `5` | Consecutive failures to open circuit |
| `ai.circuit_cooldown_ms` | `60000` | Time before half-open test |
| `ai.circuit_success_threshold` | `2` | Consecutive successes in half-open to close circuit |
| `ai.anomaly_threshold` | `0.65` | Score above which an event is classified as anomalous |
| `ai.batch_size` | `100` | Max events per HTTP request |
| `ai.base_url` | `http://ai-engine:8000` | AI Engine base URL |

### 3.5 Circuit Breaker State Machine

```mermaid
stateDiagram-v2
    [*] --> Closed

    Closed --> Open : failures >= threshold
    Closed --> Closed : success (reset counter)

    Open --> HalfOpen : cooldown elapsed

    HalfOpen --> Closed : successes >= success_threshold
    HalfOpen --> Open : any failure
```

### 3.6 Fallback Behavior

When the AI Engine is unavailable (timeout, error, circuit open), the AI Client returns a **neutral result**:

| Field | Fallback Value | Rationale |
|---|---|---|
| `alerts` | `[]` (empty) | No AI alerts generated |
| `anomalyScore` | Not computed | Events not scored by ML |
| `usedFallback` | `true` | Flagged for transparency |
| Pipeline continues? | **Yes** | Rule Engine alerts still processed |

> [!IMPORTANT]
> **The AI Engine is additive, not required.** When it is unavailable, the pipeline continues with rule-only detection. No events are lost. The dashboard displays a warning: "AI Engine offline — rule-only detection active."

---

## 4. Incident Correlation

### 4.1 Component Diagram

```mermaid
graph TB
    subgraph ICRC["Incident Correlation Component"]
        ICOR2{{"IIncidentCorrelator"}}

        subgraph ENTITY_COR["EntityCorrelator"]
            MERGE["Alert Merger<br/>Combine rule + AI alerts"]
            ENTITY["Entity Extractor<br/>User / Host / IP"]
            GROUP["Entity Grouper<br/>Group alerts by entity"]
            WINDOW["TimeWindowManager<br/>Configurable window (15 min)"]
            EXISTING["Existing Incident Matcher<br/>Find open incidents for entity"]
        end

        subgraph KC_MAP["Kill Chain Mapper (Optional)"]
            MITRE["MITRE ATT&CK Mapper<br/>Map alerts to tactics"]
            CHAIN["Chain Builder<br/>Build attack narrative"]
        end

        subgraph OUTPUT_C["Output"]
            NEW_INC["Create New Incident"]
            UPDATE_INC["Update Existing Incident<br/>(add alerts)"]
            STANDALONE["Standalone Alert<br/>(no correlation found)"]
        end
    end

    RULE_ALERTS["RuleAlert[]<br/>(from Rule Engine)"]
    AI_ALERTS2["AIAlert[]<br/>(from AI Client)"]
    IINC_OUT{{"IIncidentRepository"}}

    RULE_ALERTS --> MERGE
    AI_ALERTS2 --> MERGE
    MERGE --> ENTITY
    ENTITY --> GROUP
    GROUP --> WINDOW
    WINDOW --> EXISTING
    EXISTING -->|"open incident found"| UPDATE_INC
    EXISTING -->|"no existing incident"| NEW_INC
    EXISTING -->|"cannot correlate"| STANDALONE
    GROUP -.-> MITRE --> CHAIN

    NEW_INC --> IINC_OUT
    UPDATE_INC --> IINC_OUT
    STANDALONE --> IINC_OUT

    style ICOR2 fill:#3498db,color:#fff
    style IINC_OUT fill:#3498db,color:#fff
```

### 4.2 IIncidentCorrelator Interface

```typescript
// Domain Layer - modules/correlation/domain/IIncidentCorrelator.ts

interface IIncidentCorrelator {
  /**
   * Correlate rule alerts and AI alerts into incidents.
   * May create new incidents, update existing ones, or store standalone alerts.
   */
  correlate(
    ruleAlerts: RuleAlert[],
    aiAlerts: AIAlert[],
    events: FeatureEnrichedEvent[]
  ): Promise<CorrelationResult>;

  /**
   * Get correlator stats.
   */
  getStats(): CorrelatorStats;
}

interface CorrelationResult {
  newIncidents: Incident[];
  updatedIncidents: IncidentUpdate[];
  standaloneAlerts: Alert[];
  stats: CorrelationStats;
}

interface CorrelationStats {
  alertsReceived: number;
  incidentsCreated: number;
  incidentsUpdated: number;
  standaloneAlerts: number;
  correlationDuration_ms: number;
  entitiesExtracted: number;
}
```

### 4.3 Correlation Algorithm

```mermaid
flowchart TD
    INPUT_C["RuleAlert[] + AIAlert[]"]
    MERGE_A["Merge all alerts<br/>into unified Alert format"]
    EXTRACT["Extract entities from each alert<br/>user, host, src_ip, dst_ip"]
    DEDUP_A["Deduplicate alerts<br/>(same rule + same event = 1 alert)"]

    FOREACH["For each unique entity"]
    FIND["Query PostgreSQL<br/>Find OPEN incidents<br/>for this entity"]
    FOUND{"Open incident<br/>exists within<br/>time window?"}

    UPDATE["Add alerts to<br/>existing incident<br/>Update alert_count<br/>Update last_seen"]
    
    MULTI{"Multiple entities<br/>share alerts?"}
    MERGE_INC["Merge into single<br/>multi-entity incident"]

    CREATE["Create new incident<br/>{entity, alerts[], status: OPEN,<br/>created_at, severity: TBD}"]

    NONE{"Alert has<br/>extractable entity?"}
    STANDALONE_A["Store as standalone alert<br/>(no entity correlation possible)"]

    PASS_RS["Pass all incidents<br/>to Risk Scorer"]

    INPUT_C --> MERGE_A --> EXTRACT --> DEDUP_A --> FOREACH
    FOREACH --> NONE
    NONE -->|"no"| STANDALONE_A
    NONE -->|"yes"| FIND --> FOUND
    FOUND -->|"yes"| UPDATE
    FOUND -->|"no"| MULTI
    MULTI -->|"yes"| MERGE_INC --> CREATE
    MULTI -->|"no"| CREATE

    UPDATE --> PASS_RS
    CREATE --> PASS_RS
    STANDALONE_A --> PASS_RS

    style INPUT_C fill:#e74c3c,color:#fff
    style PASS_RS fill:#27ae60,color:#fff
```

### 4.4 Entity Extraction Rules

| Alert Field | Extracted Entity | Entity Type |
|---|---|---|
| `matchedEvents[].srcEndpoint.ip` | `192.168.1.100` | `src_ip` |
| `matchedEvents[].dstEndpoint.ip` | `10.0.0.5` | `dst_ip` |
| `matchedEvents[].actor.user.name` | `root` | `user` |
| `matchedEvents[].device.hostname` | `web-server-01` | `host` |
| `matchedEvents[].srcEndpoint.hostname` | `attacker-host` | `src_host` |

### 4.5 Correlation Rules

| Rule | Description | Example |
|---|---|---|
| **Same entity, within time window** | Alerts sharing an entity within the configured window are correlated | Failed login + successful login from `root` within 15 min |
| **Same source IP across entities** | Alerts from the same source IP targeting different users/hosts | Brute force from `192.168.1.100` against 5 different accounts |
| **Kill chain progression** | Alerts that map to consecutive MITRE ATT&CK tactics | Credential Access → Initial Access → Privilege Escalation |
| **AI + Rule agreement** | Both engines flag the same event | Rule matches brute force AND AI flags anomalous frequency |

### 4.6 Correlation Configuration

| Setting | Default | Description |
|---|---|---|
| `correlation.time_window_minutes` | `15` | Max time between alerts to be correlated |
| `correlation.max_alerts_per_incident` | `500` | Cap alerts per incident (prevent unbounded growth) |
| `correlation.entity_types` | `["user", "src_ip", "dst_ip", "host"]` | Which entity types to correlate on |
| `correlation.merge_cross_entity` | `true` | Merge incidents that share alerts across entities |
| `correlation.kill_chain_enabled` | `false` | Enable MITRE ATT&CK kill chain mapping (post-MVP) |

### 4.7 Incident Data Model

```typescript
// Domain Layer - modules/incidents/domain/Incident.ts

interface Incident {
  id: string;                   // UUID v4
  title: string;                // Auto-generated: "{severity} - {primary rule/AI finding} on {entity}"
  description: string;          // Auto-generated summary
  status: IncidentStatus;
  severity: IncidentSeverity;   // Set by Risk Scorer
  riskScore: number;            // Composite score (set by Risk Scorer)

  // Entities
  entities: IncidentEntity[];

  // Alerts
  alerts: Alert[];
  alertCount: number;

  // Events
  eventIds: string[];           // IDs of underlying OCSF events
  eventCount: number;

  // Kill Chain (optional)
  killChainStages: string[];    // MITRE ATT&CK tactics detected

  // Assignment
  assignedTo: string | null;    // User ID of assigned analyst
  notes: IncidentNote[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  firstEventAt: Date;           // Earliest event in this incident
  lastEventAt: Date;            // Latest event in this incident

  // Metadata
  source: "rule" | "ai" | "both"; // What generated this incident
  orgId: string;                // Reserved for future multi-tenancy (default: "default")
}

type IncidentStatus = "open" | "investigating" | "resolved" | "closed";
type IncidentSeverity = "critical" | "high" | "medium" | "low" | "informational";
```

### 4.8 Incident Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Open : Correlator creates incident

    Open --> Investigating : Analyst starts investigation
    Open --> Resolved : Auto-resolved (false positive)
    Open --> Closed : Admin closes (no action needed)

    Investigating --> Resolved : Analyst resolves
    Investigating --> Open : Analyst returns to triage

    Resolved --> Closed : Confirmed resolved
    Resolved --> Investigating : Re-opened (recurrence)

    Closed --> [*]

    note right of Open : Default state on creation
    note right of Investigating : Analyst assigned
    note right of Resolved : Threat mitigated
    note right of Closed : Final state, immutable
```

---

## 5. Risk Scoring

### 5.1 Component Diagram

```mermaid
graph TB
    subgraph RSC_C["Risk Scoring Component"]
        IRS2{{"IRiskScorer"}}

        subgraph COMPOSITE["CompositeRiskScorer"]
            RULE_W["Rule Weight Factor<br/>From rule definition (0.0-1.0)"]
            ML_CONF["ML Confidence Factor<br/>Anomaly score (0.0-1.0)"]
            ASSET_C["Asset Criticality Factor<br/>From asset database (0.0-1.0)"]
            ALERT_D["Alert Density Factor<br/>Alerts per time unit"]
            COMPUTE["Score Computation<br/>Weighted product"]
        end

        subgraph CLASSIFIER["SeverityClassifier"]
            MAP["Score to Severity Mapping<br/>Ranges to severity levels"]
        end
    end

    INC_IN["Incident<br/>(from Correlator)"]
    INC_OUT["Scored Incident<br/>(riskScore + severity)"]

    INC_IN --> RULE_W
    INC_IN --> ML_CONF
    INC_IN --> ASSET_C
    INC_IN --> ALERT_D
    RULE_W --> COMPUTE
    ML_CONF --> COMPUTE
    ASSET_C --> COMPUTE
    ALERT_D --> COMPUTE
    COMPUTE --> MAP
    MAP --> INC_OUT

    style IRS2 fill:#3498db,color:#fff
    style INC_OUT fill:#27ae60,color:#fff
```

### 5.2 IRiskScorer Interface

```typescript
// Domain Layer - modules/correlation/domain/IRiskScorer.ts

interface IRiskScorer {
  /**
   * Compute risk score and severity for an incident.
   */
  score(incident: Incident): Promise<ScoredIncident>;

  /**
   * Batch score multiple incidents.
   */
  scoreBatch(incidents: Incident[]): Promise<ScoredIncident[]>;
}

interface ScoredIncident extends Incident {
  riskScore: number;                    // 0.0 - 100.0
  severity: IncidentSeverity;
  scoreBreakdown: ScoreBreakdown;
}

interface ScoreBreakdown {
  ruleWeightComponent: number;          // 0.0 - 1.0
  mlConfidenceComponent: number;        // 0.0 - 1.0
  assetCriticalityComponent: number;    // 0.0 - 1.0
  alertDensityComponent: number;        // 0.0 - 1.0
  formula: string;                      // Human-readable formula used
}
```

### 5.3 Scoring Formula

The composite risk score is computed as a **weighted product**, normalized to 0-100:

```
RiskScore = 100 × (
    W_rule × RuleWeightFactor +
    W_ml   × MLConfidenceFactor +
    W_asset × AssetCriticalityFactor +
    W_density × AlertDensityFactor
)
```

Where `W_*` are configurable weights that sum to 1.0.

### 5.4 Factor Computation

| Factor | Source | Computation | Range | Default Weight |
|---|---|---|---|---|
| **Rule Weight** | Highest `weight` field from matched rules in the incident | `max(alert.weight for alert in incident.alerts where alert is RuleAlert)` | 0.0 - 1.0 | 0.35 |
| **ML Confidence** | Highest anomaly score from AI alerts in the incident | `max(alert.anomalyScore for alert in incident.alerts where alert is AIAlert)` | 0.0 - 1.0 | 0.30 |
| **Asset Criticality** | Asset database lookup for the incident's primary entity | `assetRepository.getCriticality(entity)` or `0.5` (neutral default) | 0.0 - 1.0 | 0.20 |
| **Alert Density** | Number of alerts normalized by time window | `min(1.0, alertCount / densityThreshold)` | 0.0 - 1.0 | 0.15 |

### 5.5 Missing Factor Handling

Per ADR-001, missing factors default to a **neutral weight (0.5)**:

| Scenario | Factor Value | Impact |
|---|---|---|
| AI Engine was unavailable (fallback used) | `mlConfidence = 0.5` | Neutral — doesn't inflate or deflate score |
| Asset not in database | `assetCriticality = 0.5` | Neutral |
| No rule alerts (AI-only detection) | `ruleWeight = 0.5` | Neutral |
| No AI alerts (rule-only detection) | `mlConfidence = 0.5` | Neutral |

### 5.6 Severity Classification

```mermaid
graph LR
    SCORE["Risk Score<br/>(0-100)"]
    
    S_CRIT["Critical<br/>80-100"]
    S_HIGH["High<br/>60-79"]
    S_MED["Medium<br/>40-59"]
    S_LOW["Low<br/>20-39"]
    S_INFO["Informational<br/>0-19"]

    SCORE --> S_CRIT
    SCORE --> S_HIGH
    SCORE --> S_MED
    SCORE --> S_LOW
    SCORE --> S_INFO

    style S_CRIT fill:#c0392b,color:#fff
    style S_HIGH fill:#e74c3c,color:#fff
    style S_MED fill:#f39c12,color:#fff
    style S_LOW fill:#3498db,color:#fff
    style S_INFO fill:#95a5a6,color:#fff
```

| Score Range | Severity | Dashboard Behavior |
|---|---|---|
| **80 - 100** | Critical | Immediate notification, top of incident queue, red badge |
| **60 - 79** | High | Notification, elevated in queue, orange badge |
| **40 - 59** | Medium | Normal queue position, yellow badge |
| **20 - 39** | Low | Below fold, blue badge |
| **0 - 19** | Informational | Collapsed by default, grey badge |

### 5.7 Scoring Configuration

| Setting | Default | Description |
|---|---|---|
| `scoring.weight_rule` | `0.35` | Weight for rule component |
| `scoring.weight_ml` | `0.30` | Weight for ML component |
| `scoring.weight_asset` | `0.20` | Weight for asset criticality |
| `scoring.weight_density` | `0.15` | Weight for alert density |
| `scoring.density_threshold` | `20` | Alert count that maps to density=1.0 |
| `scoring.neutral_default` | `0.5` | Default when a factor is unavailable |
| `scoring.severity_critical` | `80` | Minimum score for Critical |
| `scoring.severity_high` | `60` | Minimum score for High |
| `scoring.severity_medium` | `40` | Minimum score for Medium |
| `scoring.severity_low` | `20` | Minimum score for Low |

### 5.8 Score Breakdown Example

```json
{
  "riskScore": 78.5,
  "severity": "high",
  "scoreBreakdown": {
    "ruleWeightComponent": 0.8,
    "mlConfidenceComponent": 0.92,
    "assetCriticalityComponent": 0.9,
    "alertDensityComponent": 0.6,
    "formula": "100 * (0.35*0.8 + 0.30*0.92 + 0.20*0.9 + 0.15*0.6) = 78.5"
  }
}
```

> This incident scored High: a brute force rule fired (weight 0.8), the AI flagged it as highly anomalous (0.92), the target is a critical asset (0.9 — production database server), with moderate alert density (12 alerts in 15 min).

---

## 6. Detection Output & Storage

### 6.1 Storage Flow

```mermaid
flowchart TD
    SCORED["ScoredIncident"]

    PG_WRITE["PostgreSQL Write"]
    MDB_WRITE["MongoDB Write"]
    REDIS_PUB["Redis Pub/Sub"]
    AUDIT_WRITE["Audit Log Write"]

    subgraph PG_STORE["PostgreSQL"]
        INC_TABLE["incidents table<br/>(incident record)"]
        ALERT_TABLE["alerts table<br/>(individual alerts)"]
        INC_EVENTS["incident_events table<br/>(junction table)"]
    end

    subgraph MDB_STORE["MongoDB"]
        EVENTS_COL["normalized_events<br/>(OCSF events)"]
        AI_RESULTS["ai_results<br/>(anomaly scores + SHAP)"]
    end

    subgraph REDIS_STORE["Redis"]
        CHANNEL["Channel: incidents:new<br/>or incidents:updated"]
    end

    SCORED --> PG_WRITE
    SCORED --> MDB_WRITE
    SCORED --> REDIS_PUB
    SCORED --> AUDIT_WRITE

    PG_WRITE --> INC_TABLE
    PG_WRITE --> ALERT_TABLE
    PG_WRITE --> INC_EVENTS

    MDB_WRITE --> EVENTS_COL
    MDB_WRITE --> AI_RESULTS

    REDIS_PUB --> CHANNEL
    CHANNEL -->|"WebSocket push"| DASH["Next.js Dashboard"]

    style SCORED fill:#8e44ad,color:#fff
    style DASH fill:#3498db,color:#fff
```

### 6.2 Storage Responsibility Split

| Data | Storage | Rationale |
|---|---|---|
| Incident record (id, title, severity, status, riskScore, assignedTo, notes) | **PostgreSQL** | Relational, transactional, lifecycle management |
| Alert records (alertId, ruleId/aiModel, severity, matchedCondition) | **PostgreSQL** | Relational to incidents (foreign key) |
| Incident-event junctions (incidentId, eventId) | **PostgreSQL** | Join table for many-to-many relationship |
| Normalized OCSF events (full event documents) | **MongoDB** | High volume, flexible schema, TTL indexes |
| AI results (anomaly scores, SHAP values per event) | **MongoDB** | Nested documents, variable structure |
| Real-time notifications | **Redis Pub/Sub** | Push to WebSocket server for live dashboard |
| Audit trail (incident created/updated) | **PostgreSQL** | Immutable compliance log |

### 6.3 Notification Payload

When a new or updated incident is persisted, a notification is published to Redis for real-time dashboard updates:

```json
{
  "type": "INCIDENT_CREATED",
  "data": {
    "incidentId": "inc-abc123",
    "title": "HIGH - SSH Brute Force on web-server-01",
    "severity": "high",
    "riskScore": 78.5,
    "alertCount": 12,
    "primaryEntity": "192.168.1.100",
    "createdAt": "2026-07-18T03:15:30.000Z",
    "source": "both"
  }
}
```

| Channel | Event Type | Description |
|---|---|---|
| `incidents:new` | `INCIDENT_CREATED` | New incident created |
| `incidents:updated` | `INCIDENT_UPDATED` | Alerts added to existing incident |
| `incidents:status` | `INCIDENT_STATUS_CHANGED` | Analyst changed status |
| `collector:status` | `COLLECTOR_HEARTBEAT` | Collector health update |

### 6.4 End-to-End Worker Pipeline (Complete)

```mermaid
flowchart TD
    JOB["Dequeued Job<br/>{filePath}"]

    subgraph PART1["BACKEND-001: Ingestion and Processing"]
        READ["Read File"]
        VALIDATE["Validate<br/>(file + schema)"]
        PARSE["Parse<br/>(batch + format)"]
        NORMALIZE["Normalize<br/>(OCSF + enrichment)"]
        EXTRACT["Feature Extraction<br/>(temporal + frequency + entropy + ...)"]
    end

    subgraph PART2["BACKEND-002: Detection and Response"]
        RULE_E["Rule Engine<br/>(Sigma matching)"]
        AI_C["AI Client<br/>(HTTP to FastAPI)"]
        CORRELATE["Incident Correlator<br/>(entity + time window grouping)"]
        SCORE_E["Risk Scorer<br/>(composite scoring)"]
    end

    subgraph PERSIST_E["Persistence"]
        PG_P[("PostgreSQL<br/>Incidents + Alerts")]
        MDB_P[("MongoDB<br/>Events + AI Results")]
        RD_P[("Redis Pub/Sub<br/>Dashboard Notification")]
    end

    CLEANUP_E["Cleanup<br/>Archive or delete<br/>processed file"]
    RESULT_E["Return JobResult"]

    JOB --> READ --> VALIDATE
    VALIDATE -->|"invalid"| QUARANTINE_E["Quarantine"]
    VALIDATE -->|"valid"| PARSE --> NORMALIZE --> EXTRACT
    EXTRACT --> RULE_E
    EXTRACT --> AI_C
    RULE_E --> CORRELATE
    AI_C --> CORRELATE
    CORRELATE --> SCORE_E
    SCORE_E --> PG_P
    SCORE_E --> MDB_P
    SCORE_E --> RD_P
    SCORE_E --> CLEANUP_E --> RESULT_E

    style JOB fill:#8e44ad,color:#fff
    style PG_P fill:#27ae60,color:#fff
    style MDB_P fill:#27ae60,color:#fff
    style QUARANTINE_E fill:#e74c3c,color:#fff
```

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) and continues from [BACKEND-001](file:///d:/AI%20SIEM/docs/backend.md). Together, BACKEND-001 and BACKEND-002 define the complete worker pipeline: from file detection to scored incidents in the database and real-time dashboard notifications.**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-18
