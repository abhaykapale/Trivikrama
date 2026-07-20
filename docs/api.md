# REST API Documentation

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | API-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-19 |
| **Status** | Draft |
| **Base URL (Backend)** | `http://localhost:3000/api/v1` |
| **Base URL (AI Engine)** | `http://ai-engine:8000/api/v1` (internal only) |
| **Authentication** | JWT Bearer Token (httpOnly cookie) |
| **Content Type** | `application/json` |

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Dashboard](#2-dashboard)
3. [Incidents](#3-incidents)
4. [Events (Investigation)](#4-events-investigation)
5. [Rules](#5-rules)
6. [Collector](#6-collector)
7. [Users](#7-users)
8. [Assets](#8-assets)
9. [Audit](#9-audit)
10. [Configuration](#10-configuration)
11. [AI Engine (Internal)](#11-ai-engine-internal)

---

## Global Conventions

### Authentication

All endpoints except `POST /auth/login` require a valid JWT.

| Header / Cookie | Value |
|---|---|
| Cookie | `siem_token=<JWT>` (set automatically by login) |
| Alternative | `Authorization: Bearer <JWT>` (for programmatic clients) |

### Standard Error Response

Every error follows this structure:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Incident with ID inc-999 not found",
    "details": {}
  }
}
```

### Pagination

All list endpoints support cursor-based pagination:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page (max 100) |
| `sort` | string | varies | Sort field |
| `order` | string | `desc` | `asc` or `desc` |

Paginated responses include:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 142,
    "totalPages": 6,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Common Status Codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `204` | No Content (successful delete) |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (missing or invalid token) |
| `403` | Forbidden (insufficient role) |
| `404` | Not Found |
| `409` | Conflict (duplicate resource) |
| `422` | Unprocessable Entity (semantic validation failure) |
| `429` | Too Many Requests (rate limited) |
| `500` | Internal Server Error |

---

## 1. Authentication

### POST /auth/login

Authenticate a user and receive a JWT token.

**Access:** Public (no authentication required)

**Request:**

```json
{
  "username": "jsmith",
  "password": "SecureP@ssw0rd!"
}
```

**Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr-abc123",
    "username": "jsmith",
    "email": "jsmith@corp.local",
    "role": "soc_analyst",
    "displayName": "John Smith",
    "lastLoginAt": "2026-07-18T10:00:00Z"
  },
  "expiresAt": "2026-07-19T11:00:00Z"
}
```

The response also sets a `Set-Cookie` header:

```
Set-Cookie: siem_token=eyJhbG...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600
```

**Error (401):**

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid username or password"
  }
}
```

**Error (423 — Account Locked):**

```json
{
  "error": {
    "code": "ACCOUNT_LOCKED",
    "message": "Account locked due to too many failed attempts. Try again after 2026-07-19T10:30:00Z"
  }
}
```

---

### POST /auth/logout

Revoke the current session.

**Access:** All authenticated users

**Request:** No body. Token read from cookie.

**Response (200):**

```json
{
  "message": "Logged out successfully"
}
```

The response clears the cookie:

```
Set-Cookie: siem_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0
```

---

### POST /auth/refresh

Refresh an expiring access token.

**Access:** All authenticated users (token must be valid or recently expired within a grace period)

**Request:** No body. Token read from cookie.

**Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2026-07-19T12:00:00Z"
}
```

**Error (401):**

```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "Session expired. Please login again"
  }
}
```

---

### GET /auth/me

Get the currently authenticated user's profile.

**Access:** All authenticated users

**Response (200):**

```json
{
  "id": "usr-abc123",
  "username": "jsmith",
  "email": "jsmith@corp.local",
  "role": "soc_analyst",
  "displayName": "John Smith",
  "isActive": true,
  "lastLoginAt": "2026-07-19T10:00:00Z",
  "createdAt": "2026-06-01T08:00:00Z"
}
```

---

## 2. Dashboard

### GET /dashboard/summary

Aggregate KPI metrics for the dashboard.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | string | `24h` | Time range: `1h`, `4h`, `24h`, `7d`, `30d` |

**Response (200):**

```json
{
  "timeRange": "24h",
  "incidents": {
    "open": 142,
    "openTrend": 12.5,
    "critical": 7,
    "criticalTrend": 2,
    "investigating": 23,
    "resolvedToday": 15,
    "closedToday": 8
  },
  "alerts": {
    "totalToday": 89,
    "alertsTrend": 15.2,
    "ruleAlerts": 62,
    "aiAlerts": 27
  },
  "events": {
    "eventsPerSecond": 2450,
    "epsTrend": -5.1,
    "totalToday": 8540000
  },
  "responseTime": {
    "avgMinutes": 23,
    "avgTrend": -8.3,
    "medianMinutes": 18
  },
  "severityDistribution": {
    "critical": 7,
    "high": 23,
    "medium": 56,
    "low": 42,
    "informational": 14
  },
  "aiEngine": {
    "status": "online",
    "modelVersion": "v20260718_120000",
    "anomaliesDetected": 27
  }
}
```

---

### GET /dashboard/timeline

Incident count over time, grouped by severity.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | string | `24h` | `1h`, `4h`, `24h`, `7d`, `30d` |
| `interval` | string | auto | `5m`, `15m`, `1h`, `6h`, `1d` (auto-selected from range if omitted) |

**Response (200):**

```json
{
  "timeRange": "24h",
  "interval": "1h",
  "buckets": [
    {
      "timestamp": "2026-07-18T00:00:00Z",
      "critical": 0,
      "high": 2,
      "medium": 5,
      "low": 3,
      "informational": 1,
      "total": 11
    },
    {
      "timestamp": "2026-07-18T01:00:00Z",
      "critical": 1,
      "high": 3,
      "medium": 4,
      "low": 2,
      "informational": 0,
      "total": 10
    }
  ]
}
```

---

### GET /dashboard/top-assets

Assets with the highest incident counts.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | string | `24h` | Time range |
| `limit` | integer | `10` | Number of assets to return |

**Response (200):**

```json
{
  "assets": [
    {
      "entity": "web-server-01",
      "entityType": "host",
      "incidentCount": 12,
      "criticalCount": 2,
      "highCount": 5,
      "latestIncidentAt": "2026-07-18T15:30:00Z"
    },
    {
      "entity": "db-server-03",
      "entityType": "host",
      "incidentCount": 8,
      "criticalCount": 1,
      "highCount": 3,
      "latestIncidentAt": "2026-07-18T14:00:00Z"
    }
  ]
}
```

---

### GET /dashboard/source-breakdown

Event counts grouped by collector source type.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | string | `24h` | Time range |

**Response (200):**

```json
{
  "sources": [
    { "source": "syslog", "eventCount": 4200000, "percentage": 49.2 },
    { "source": "windows_etw", "eventCount": 2800000, "percentage": 32.8 },
    { "source": "file", "eventCount": 1200000, "percentage": 14.0 },
    { "source": "http", "eventCount": 340000, "percentage": 4.0 }
  ],
  "total": 8540000
}
```

---

## 3. Incidents

### GET /incidents

List all incidents with filtering, sorting, and pagination.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |
| `status` | string | — | Filter: `open`, `investigating`, `resolved`, `closed` (comma-separated for multiple) |
| `severity` | string | — | Filter: `critical`, `high`, `medium`, `low`, `informational` |
| `source` | string | — | Filter: `rule`, `ai`, `both` |
| `assignedTo` | string | — | Filter by user ID |
| `search` | string | — | Full-text search on title, description, entity |
| `from` | ISO 8601 | — | Created after |
| `to` | ISO 8601 | — | Created before |
| `sort` | string | `createdAt` | `createdAt`, `riskScore`, `severity`, `alertCount`, `updatedAt` |
| `order` | string | `desc` | `asc`, `desc` |

**Response (200):**

```json
{
  "data": [
    {
      "id": "inc-0142",
      "title": "HIGH — SSH Brute Force on web-server-01",
      "status": "open",
      "severity": "high",
      "riskScore": 78.5,
      "source": "both",
      "primaryEntity": "192.168.1.100",
      "entityType": "src_ip",
      "alertCount": 12,
      "eventCount": 48,
      "assignedTo": null,
      "firstEventAt": "2026-07-18T03:10:00Z",
      "lastEventAt": "2026-07-18T03:25:00Z",
      "createdAt": "2026-07-18T03:15:30Z",
      "updatedAt": "2026-07-18T03:25:30Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 142,
    "totalPages": 6,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### GET /incidents/:id

Get full incident detail.

**Access:** All authenticated users

**Response (200):**

```json
{
  "id": "inc-0142",
  "title": "HIGH — SSH Brute Force on web-server-01",
  "description": "Multiple failed SSH login attempts detected from 192.168.1.100 targeting user root on web-server-01, followed by a successful login and anomalous process execution.",
  "status": "open",
  "severity": "high",
  "riskScore": 78.5,
  "source": "both",
  "scoreBreakdown": {
    "ruleWeightComponent": 0.80,
    "mlConfidenceComponent": 0.92,
    "assetCriticalityComponent": 0.90,
    "alertDensityComponent": 0.60,
    "killChainBonusComponent": 0.67,
    "formula": "100 × (0.30×0.80 + 0.25×0.92 + 0.20×0.90 + 0.15×0.60 + 0.10×0.67) = 78.5"
  },
  "entities": [
    { "value": "192.168.1.100", "type": "src_ip" },
    { "value": "root", "type": "user" },
    { "value": "web-server-01", "type": "host" }
  ],
  "primaryEntity": "192.168.1.100",
  "entityType": "src_ip",
  "killChainStages": ["credential_access", "privilege_escalation"],
  "alertCount": 12,
  "eventCount": 48,
  "assignedTo": null,
  "notes": [],
  "firstEventAt": "2026-07-18T03:10:00Z",
  "lastEventAt": "2026-07-18T03:25:00Z",
  "createdAt": "2026-07-18T03:15:30Z",
  "updatedAt": "2026-07-18T03:25:30Z",
  "resolvedAt": null,
  "closedAt": null
}
```

**Error (404):**

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Incident with ID inc-999 not found"
  }
}
```

---

### GET /incidents/:id/alerts

Get all alerts for an incident.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Filter: `rule`, `ai` |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "id": "alt-001",
      "incidentId": "inc-0142",
      "alertType": "rule",
      "ruleId": "rule-bf-ssh-001",
      "ruleName": "SSH Brute Force",
      "matchedCondition": "count(src_endpoint.ip) >= 10 within 5m",
      "severity": "high",
      "weight": 0.8,
      "tags": ["attack.credential_access", "attack.t1110"],
      "matchedEventIds": ["evt-001", "evt-002", "evt-003"],
      "createdAt": "2026-07-18T03:15:22Z"
    },
    {
      "id": "alt-002",
      "incidentId": "inc-0142",
      "alertType": "ai",
      "anomalyScore": 0.89,
      "confidence": 0.92,
      "threatCategory": "brute_force",
      "modelVersion": "v20260718_120000",
      "shapValues": {
        "baseValue": 0.32,
        "features": [
          { "name": "events_per_minute_src_ip", "value": 45.0, "shapValue": 0.28 },
          { "name": "failed_login_count_10min", "value": 38.0, "shapValue": 0.22 }
        ]
      },
      "severity": "high",
      "weight": 0.89,
      "matchedEventIds": ["evt-010"],
      "createdAt": "2026-07-18T03:16:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 12, "totalPages": 1 }
}
```

---

### GET /incidents/:id/timeline

Chronological timeline of events, alerts, and actions.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Filter: `event`, `alert`, `action` |
| `from` | ISO 8601 | — | Start time |
| `to` | ISO 8601 | — | End time |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "id": "tl-001",
      "type": "event",
      "timestamp": "2026-07-18T03:10:01Z",
      "eventId": "evt-001",
      "eventClassUid": 3002,
      "eventMessage": "Failed password for root from 192.168.1.100 port 22 ssh2",
      "eventSeverity": 3
    },
    {
      "id": "tl-012",
      "type": "alert",
      "timestamp": "2026-07-18T03:15:22Z",
      "alertId": "alt-001",
      "alertType": "rule",
      "alertSeverity": "high",
      "alertTitle": "SSH Brute Force",
      "anomalyScore": null
    },
    {
      "id": "tl-020",
      "type": "action",
      "timestamp": "2026-07-18T03:15:30Z",
      "action": "created",
      "actorId": "system",
      "actorName": "System",
      "newValue": "open"
    },
    {
      "id": "tl-025",
      "type": "action",
      "timestamp": "2026-07-18T10:12:00Z",
      "action": "assigned",
      "actorId": "usr-abc123",
      "actorName": "John Smith",
      "newValue": "usr-def456"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 65, "totalPages": 2 }
}
```

---

### GET /incidents/:id/events

Get normalized OCSF events linked to this incident.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "eventId": "evt-001",
      "classUid": 3002,
      "categoryUid": 3,
      "severityId": 3,
      "time": "2026-07-18T03:10:01Z",
      "message": "Failed password for root from 192.168.1.100 port 22 ssh2",
      "srcEndpoint": { "ip": "192.168.1.100", "port": 54321 },
      "dstEndpoint": { "ip": "10.0.0.5", "port": 22 },
      "actor": { "user": { "name": "root" } },
      "device": { "hostname": "web-server-01" },
      "features": {
        "temporal": { "hour_of_day": 3, "is_business_hours": 0 },
        "frequency": { "events_per_minute_src_ip": 45 }
      }
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 48, "totalPages": 2 }
}
```

---

### GET /incidents/:id/context

Historical context for the incident's entities.

**Access:** All authenticated users

**Response (200):**

```json
{
  "previousIncidents": [
    {
      "id": "inc-0098",
      "title": "MEDIUM — Unusual Login Time on web-server-01",
      "severity": "medium",
      "status": "closed",
      "createdAt": "2026-07-11T02:30:00Z"
    }
  ],
  "assets": [
    {
      "name": "web-server-01",
      "assetType": "server",
      "ipAddress": "10.0.0.5",
      "criticality": 0.9,
      "owner": "DevOps Team",
      "department": "Engineering",
      "tags": ["production", "web"]
    }
  ],
  "entityHistory": {
    "192.168.1.100": {
      "firstSeenAt": "2026-07-18T03:10:00Z",
      "incidentCount30d": 1,
      "alertCount30d": 12
    },
    "root": {
      "firstSeenAt": "2026-06-01T08:00:00Z",
      "incidentCount30d": 3,
      "alertCount30d": 45
    }
  }
}
```

---

### PUT /incidents/:id/status

Change incident status.

**Access:** All authenticated users

**Request:**

```json
{
  "status": "investigating"
}
```

Valid transitions: `open` → `investigating`, `investigating` → `resolved`, `investigating` → `open`, `resolved` → `closed`, `resolved` → `investigating`, `open` → `closed`.

**Response (200):**

```json
{
  "id": "inc-0142",
  "status": "investigating",
  "updatedAt": "2026-07-18T10:12:05Z"
}
```

**Error (422):**

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "Cannot transition from 'closed' to 'investigating'"
  }
}
```

---

### PUT /incidents/:id/assign

Assign an incident to an analyst.

**Access:** Admin, Security Engineer

**Request:**

```json
{
  "assignedTo": "usr-def456"
}
```

Set `assignedTo` to `null` to unassign.

**Response (200):**

```json
{
  "id": "inc-0142",
  "assignedTo": "usr-def456",
  "updatedAt": "2026-07-18T10:12:00Z"
}
```

---

### POST /incidents/:id/notes

Add an investigation note.

**Access:** All authenticated users

**Request:**

```json
{
  "content": "Confirmed compromised credentials. Isolating host via network team."
}
```

**Response (201):**

```json
{
  "id": "note-001",
  "incidentId": "inc-0142",
  "authorId": "usr-abc123",
  "authorName": "John Smith",
  "content": "Confirmed compromised credentials. Isolating host via network team.",
  "createdAt": "2026-07-18T10:30:00Z"
}
```

---

### PUT /incidents/:id/resolve

Resolve an incident with a reason.

**Access:** All authenticated users

**Request:**

```json
{
  "resolution": "tp_mitigated",
  "note": "Compromised credentials rotated. Host reimaged. Firewall rule added for source IP."
}
```

Valid resolution codes: `tp_mitigated`, `tp_accepted`, `fp_rule_tuning`, `fp_ai_noise`, `fp_known`, `duplicate`, `informational`.

**Response (200):**

```json
{
  "id": "inc-0142",
  "status": "resolved",
  "resolution": "tp_mitigated",
  "resolvedAt": "2026-07-18T11:00:00Z",
  "updatedAt": "2026-07-18T11:00:00Z"
}
```

---

## 4. Events (Investigation)

### GET /events/search

Search normalized OCSF events in MongoDB.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Full-text search on `message` field |
| `classUid` | integer | — | OCSF class UID filter |
| `severityId` | integer | — | Severity filter (0-6) |
| `srcIp` | string | — | Source IP filter |
| `dstIp` | string | — | Destination IP filter |
| `username` | string | — | Actor username filter |
| `hostname` | string | — | Device hostname filter |
| `from` | ISO 8601 | 24h ago | Start time |
| `to` | ISO 8601 | now | End time |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Items per page (max 200) |
| `sort` | string | `time` | Sort field: `time`, `severityId` |
| `order` | string | `desc` | `asc`, `desc` |

**Response (200):**

```json
{
  "data": [
    {
      "eventId": "evt-001",
      "classUid": 3002,
      "categoryUid": 3,
      "severityId": 3,
      "time": "2026-07-18T03:10:01Z",
      "message": "Failed password for root from 192.168.1.100 port 22 ssh2",
      "srcEndpoint": { "ip": "192.168.1.100", "port": 54321 },
      "dstEndpoint": { "ip": "10.0.0.5", "port": 22 },
      "actor": { "user": { "name": "root" }, "process": null },
      "device": { "hostname": "web-server-01", "os": { "name": "Ubuntu", "version": "22.04" } },
      "metadata": { "version": "1.1.0", "product": { "name": "sshd" } },
      "enrichments": {
        "geoSrc": { "country": "CN", "city": "Beijing" },
        "assetCriticality": 0.9
      },
      "features": {
        "temporal": { "hourOfDay": 3, "isBusinessHours": 0, "timeDeviationScore": 2.8 },
        "frequency": { "eventsPerMinuteSrcIp": 45, "frequencyDeviation": 4.2 },
        "authentication": { "failedLoginCount10min": 38, "failedToSuccessRatio": 0.97 }
      },
      "ingestion": {
        "batchId": "batch-2026-07-18-031000",
        "collectorId": "collector-01",
        "ingestedAt": "2026-07-18T03:10:05Z"
      }
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1250, "totalPages": 25 }
}
```

---

### GET /events/:eventId

Get a single normalized event by ID.

**Access:** All authenticated users

**Response (200):** Same structure as a single item from the search results above.

**Error (404):**

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Event with ID evt-999 not found"
  }
}
```

---

### GET /events/export

Export search results as CSV.

**Access:** All authenticated users

**Query Parameters:** Same as `GET /events/search`, plus:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `format` | string | `csv` | Export format: `csv`, `json` |
| `maxResults` | integer | `10000` | Max rows to export |

**Response (200):**

```
Content-Type: text/csv
Content-Disposition: attachment; filename="events_export_20260718.csv"

event_id,class_uid,severity_id,time,message,src_ip,dst_ip,username,hostname
evt-001,3002,3,2026-07-18T03:10:01Z,"Failed password for root...",192.168.1.100,10.0.0.5,root,web-server-01
...
```

---

## 5. Rules

### GET /rules

List all detection rules.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | `active`, `disabled`, `archived` |
| `type` | string | — | `match`, `count`, `sequence` |
| `severity` | string | — | `critical`, `high`, `medium`, `low`, `informational` |
| `search` | string | — | Search in name, description, tags |
| `tag` | string | — | MITRE ATT&CK tag filter |
| `isBuiltin` | boolean | — | `true` for system rules, `false` for custom |
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |
| `sort` | string | `name` | `name`, `severity`, `status`, `createdAt`, `updatedAt` |
| `order` | string | `asc` | `asc`, `desc` |

**Response (200):**

```json
{
  "data": [
    {
      "id": "rule-bf-ssh-001",
      "name": "SSH Brute Force",
      "description": "Detects multiple failed SSH login attempts from the same source IP",
      "status": "active",
      "type": "count",
      "severity": "high",
      "weight": 0.8,
      "priority": 800,
      "classUid": 3002,
      "categoryUid": 3,
      "tags": ["attack.credential_access", "attack.t1110"],
      "isBuiltin": true,
      "version": 1,
      "alertsGenerated": 245,
      "lastTriggeredAt": "2026-07-18T15:30:00Z",
      "createdAt": "2026-07-01T08:00:00Z",
      "updatedAt": "2026-07-01T08:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 15, "totalPages": 1 }
}
```

---

### GET /rules/:id

Get a single rule with full YAML content.

**Access:** All authenticated users

**Response (200):**

```json
{
  "id": "rule-bf-ssh-001",
  "name": "SSH Brute Force",
  "description": "Detects multiple failed SSH login attempts from the same source IP within a short time window.",
  "status": "active",
  "type": "count",
  "severity": "high",
  "weight": 0.8,
  "priority": 800,
  "classUid": 3002,
  "categoryUid": 3,
  "tags": ["attack.credential_access", "attack.t1110"],
  "falsePositives": ["Automated testing", "Legitimate password reset"],
  "references": ["https://attack.mitre.org/techniques/T1110/"],
  "yamlContent": "title: SSH Brute Force\nid: rule-bf-ssh-001\nlevel: high\nweight: 0.8\npriority: 800\nlogsource:\n  class_uid: 3002\ndetection:\n  selection:\n    message|contains: \"Failed password\"\n  condition: \"selection\"\n  count:\n    field: \"src_endpoint.ip\"\n    threshold: 10\n    timewindow: \"5m\"\nalert:\n  cooldown: \"5m\"\ntags:\n  - attack.credential_access\n  - attack.t1110\n",
  "compiledHash": "a1b2c3d4e5f6...",
  "isBuiltin": true,
  "version": 1,
  "createdBy": null,
  "updatedBy": null,
  "createdAt": "2026-07-01T08:00:00Z",
  "updatedAt": "2026-07-01T08:00:00Z"
}
```

---

### POST /rules

Create a new detection rule.

**Access:** Admin, Security Engineer

**Request:**

```json
{
  "yamlContent": "title: Custom Data Exfiltration\nid: rule-exfil-001\nlevel: high\nweight: 0.75\npriority: 750\nlogsource:\n  class_uid: 4001\ndetection:\n  selection:\n    features.volume.bytes_sent|gt: 100000000\n    features.temporal.is_business_hours: 0\n  condition: \"selection\"\ntags:\n  - attack.exfiltration\n  - attack.t1048\n"
}
```

**Response (201):**

```json
{
  "id": "rule-exfil-001",
  "name": "Custom Data Exfiltration",
  "status": "active",
  "type": "match",
  "severity": "high",
  "version": 1,
  "createdAt": "2026-07-19T10:00:00Z"
}
```

**Error (400 — Validation):**

```json
{
  "error": {
    "code": "RULE_VALIDATION_FAILED",
    "message": "Rule validation failed",
    "details": {
      "errors": [
        "Missing required field: logsource.class_uid",
        "Unknown operator: message|fuzzy"
      ]
    }
  }
}
```

**Error (409 — Duplicate):**

```json
{
  "error": {
    "code": "RULE_ID_EXISTS",
    "message": "Rule with ID rule-exfil-001 already exists"
  }
}
```

---

### PUT /rules/:id

Update an existing rule.

**Access:** Admin, Security Engineer

**Request:**

```json
{
  "yamlContent": "title: Custom Data Exfiltration v2\n..."
}
```

**Response (200):**

```json
{
  "id": "rule-exfil-001",
  "name": "Custom Data Exfiltration v2",
  "version": 2,
  "updatedAt": "2026-07-19T11:00:00Z"
}
```

**Error (403 — Builtin):**

```json
{
  "error": {
    "code": "CANNOT_MODIFY_BUILTIN",
    "message": "Built-in rules cannot be modified. Clone the rule to create a custom version."
  }
}
```

---

### DELETE /rules/:id

Soft-delete (archive) a rule.

**Access:** Admin only

**Response (200):**

```json
{
  "id": "rule-exfil-001",
  "status": "archived",
  "updatedAt": "2026-07-19T12:00:00Z"
}
```

**Error (403):**

```json
{
  "error": {
    "code": "CANNOT_DELETE_BUILTIN",
    "message": "Built-in rules cannot be deleted"
  }
}
```

---

### PUT /rules/:id/enable

Activate a disabled rule.

**Access:** Admin, Security Engineer

**Response (200):**

```json
{
  "id": "rule-exfil-001",
  "status": "active",
  "updatedAt": "2026-07-19T12:05:00Z"
}
```

---

### PUT /rules/:id/disable

Deactivate a rule without deleting it.

**Access:** Admin, Security Engineer

**Response (200):**

```json
{
  "id": "rule-exfil-001",
  "status": "disabled",
  "updatedAt": "2026-07-19T12:10:00Z"
}
```

---

### POST /rules/:id/test

Dry-run a rule against historical events.

**Access:** All authenticated users

**Request:**

```json
{
  "timeRange": "24h",
  "limit": 1000
}
```

**Response (200):**

```json
{
  "ruleId": "rule-exfil-001",
  "ruleName": "Custom Data Exfiltration",
  "totalEvaluated": 1000,
  "matches": 15,
  "matchedEventIds": ["evt-100", "evt-200", "evt-300"],
  "executionTimeMs": 230,
  "sampleMatches": [
    {
      "eventId": "evt-100",
      "time": "2026-07-18T22:00:00Z",
      "message": "Large data transfer to external IP",
      "matchedCondition": "bytes_sent > 100000000 AND is_business_hours = 0"
    }
  ]
}
```

---

### POST /rules/import

Bulk import Sigma rules from YAML.

**Access:** Admin, Security Engineer

**Request:**

```
Content-Type: text/yaml
```

```yaml
title: Rule One
id: rule-import-001
level: high
# ... full rule ...
---
title: Rule Two
id: rule-import-002
level: medium
# ... full rule ...
```

**Response (200):**

```json
{
  "imported": 2,
  "skipped": 0,
  "failed": 0,
  "results": [
    { "id": "rule-import-001", "name": "Rule One", "status": "imported" },
    { "id": "rule-import-002", "name": "Rule Two", "status": "imported" }
  ]
}
```

---

### GET /rules/export

Export all active rules as YAML.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | `active` | Which rules to export |

**Response (200):**

```
Content-Type: text/yaml
Content-Disposition: attachment; filename="rules_export_20260719.yaml"

title: SSH Brute Force
id: rule-bf-ssh-001
...
---
title: RDP Brute Force
id: rule-bf-rdp-001
...
```

---

## 6. Collector

### GET /collector/status

Get health status of all collectors, queue, and AI Engine.

**Access:** All authenticated users

**Response (200):**

```json
{
  "collectors": [
    {
      "collectorId": "collector-01",
      "status": "online",
      "lastHeartbeatAt": "2026-07-19T10:59:30Z",
      "filesProcessed": 145230,
      "eventsCollected": 8540000,
      "eventsDropped": 12,
      "errorsCount": 3,
      "cpuPercent": 15.2,
      "memoryMb": 128.5,
      "firstSeenAt": "2026-07-01T08:00:00Z"
    },
    {
      "collectorId": "collector-02",
      "status": "offline",
      "lastHeartbeatAt": "2026-07-19T09:45:00Z",
      "filesProcessed": 98000,
      "eventsCollected": 5200000,
      "eventsDropped": 0,
      "errorsCount": 0,
      "cpuPercent": null,
      "memoryMb": null,
      "firstSeenAt": "2026-07-05T12:00:00Z"
    }
  ],
  "queue": {
    "name": "processing-queue",
    "waiting": 234,
    "active": 4,
    "completed": 145000,
    "failed": 12,
    "deadLettered": 3,
    "isPaused": false
  },
  "aiEngine": {
    "status": "online",
    "modelVersion": "v20260718_120000",
    "uptimeSeconds": 86400,
    "totalPredictions": 1250000,
    "avgLatencyMs": 35,
    "p99LatencyMs": 120
  }
}
```

---

### GET /collector/quarantine

List quarantined (failed) batch files.

**Access:** Admin, Security Engineer

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "filePath": "quarantine/batch_20260718_031500_ERR.json",
      "originalPath": "collector/batch_20260718_031500.json",
      "error": "Schema validation failed: missing required field class_uid",
      "quarantinedAt": "2026-07-18T03:15:05Z",
      "fileSizeBytes": 45230,
      "eventCount": 50
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 3, "totalPages": 1 }
}
```

---

### POST /collector/quarantine/:filename/retry

Re-process a quarantined file.

**Access:** Admin, Security Engineer

**Response (200):**

```json
{
  "filename": "batch_20260718_031500_ERR.json",
  "status": "requeued",
  "message": "File moved from quarantine back to processing queue"
}
```

---

## 7. Users

### GET /users

List all users.

**Access:** Admin only

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `role` | string | — | Filter by role |
| `isActive` | boolean | — | Filter by active status |
| `search` | string | — | Search in username, email, displayName |
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "id": "usr-abc123",
      "username": "jsmith",
      "email": "jsmith@corp.local",
      "role": "soc_analyst",
      "displayName": "John Smith",
      "isActive": true,
      "lastLoginAt": "2026-07-19T10:00:00Z",
      "createdAt": "2026-06-01T08:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 8, "totalPages": 1 }
}
```

---

### GET /users/:id

Get a single user.

**Access:** Admin only (or the user themselves via `/auth/me`)

**Response (200):** Same structure as list item.

---

### POST /users

Create a new user.

**Access:** Admin only

**Request:**

```json
{
  "username": "agarcia",
  "email": "agarcia@corp.local",
  "password": "InitialP@ss123!",
  "role": "security_engineer",
  "displayName": "Ana Garcia"
}
```

**Response (201):**

```json
{
  "id": "usr-xyz789",
  "username": "agarcia",
  "email": "agarcia@corp.local",
  "role": "security_engineer",
  "displayName": "Ana Garcia",
  "isActive": true,
  "createdAt": "2026-07-19T10:00:00Z"
}
```

**Error (409):**

```json
{
  "error": {
    "code": "USERNAME_EXISTS",
    "message": "Username agarcia already exists"
  }
}
```

---

### PUT /users/:id

Update user profile.

**Access:** Admin only

**Request:**

```json
{
  "role": "admin",
  "displayName": "Ana Garcia (Lead)"
}
```

**Response (200):**

```json
{
  "id": "usr-xyz789",
  "role": "admin",
  "displayName": "Ana Garcia (Lead)",
  "updatedAt": "2026-07-19T11:00:00Z"
}
```

---

### PUT /users/:id/deactivate

Deactivate a user account (soft-delete).

**Access:** Admin only

**Response (200):**

```json
{
  "id": "usr-xyz789",
  "isActive": false,
  "updatedAt": "2026-07-19T12:00:00Z"
}
```

---

### PUT /users/:id/reset-password

Reset a user's password.

**Access:** Admin only

**Request:**

```json
{
  "newPassword": "NewSecureP@ss456!"
}
```

**Response (200):**

```json
{
  "message": "Password reset successfully",
  "userId": "usr-xyz789"
}
```

---

## 8. Assets

### GET /assets

List all registered assets.

**Access:** All authenticated users

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | `server`, `workstation`, `network_device`, `application` |
| `search` | string | — | Search in name, hostname, IP |
| `isActive` | boolean | `true` | Filter by active status |
| `page` | integer | `1` | Page number |
| `limit` | integer | `25` | Items per page |

**Response (200):**

```json
{
  "data": [
    {
      "id": "asset-001",
      "name": "web-server-01",
      "assetType": "server",
      "ipAddress": "10.0.0.5",
      "hostname": "web-server-01",
      "criticality": 0.9,
      "owner": "DevOps Team",
      "department": "Engineering",
      "tags": ["production", "web"],
      "isActive": true,
      "createdAt": "2026-06-01T08:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 45, "totalPages": 2 }
}
```

---

### GET /assets/:id

Get a single asset.

**Access:** All authenticated users

**Response (200):** Same structure as list item with full `metadata` JSONB field.

---

### POST /assets

Register a new asset.

**Access:** Admin, Security Engineer

**Request:**

```json
{
  "name": "db-server-03",
  "assetType": "server",
  "ipAddress": "10.0.0.20",
  "hostname": "db-server-03",
  "criticality": 0.95,
  "owner": "DBA Team",
  "department": "Data Engineering",
  "tags": ["production", "database", "pci"]
}
```

**Response (201):**

```json
{
  "id": "asset-046",
  "name": "db-server-03",
  "criticality": 0.95,
  "createdAt": "2026-07-19T10:00:00Z"
}
```

---

### PUT /assets/:id

Update an asset.

**Access:** Admin, Security Engineer

**Request:**

```json
{
  "criticality": 1.0,
  "tags": ["production", "database", "pci", "critical"]
}
```

**Response (200):**

```json
{
  "id": "asset-046",
  "criticality": 1.0,
  "updatedAt": "2026-07-19T11:00:00Z"
}
```

---

### DELETE /assets/:id

Deactivate an asset (soft-delete).

**Access:** Admin only

**Response (200):**

```json
{
  "id": "asset-046",
  "isActive": false,
  "updatedAt": "2026-07-19T12:00:00Z"
}
```

---

## 9. Audit

### GET /audit

List audit log entries.

**Access:** Admin, Security Engineer

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `action` | string | — | Filter by action type (e.g., `incident_create`, `rule_update`, `login`) |
| `actorId` | string | — | Filter by actor user ID |
| `targetType` | string | — | `incident`, `rule`, `user`, `config` |
| `targetId` | string | — | Specific target ID |
| `from` | ISO 8601 | 24h ago | Start time |
| `to` | ISO 8601 | now | End time |
| `page` | integer | `1` | Page number |
| `limit` | integer | `50` | Items per page |
| `sort` | string | `createdAt` | Sort field |
| `order` | string | `desc` | `asc`, `desc` |

**Response (200):**

```json
{
  "data": [
    {
      "id": "aud-001",
      "action": "incident_status_change",
      "actorId": "usr-abc123",
      "actorUsername": "jsmith",
      "actorRole": "soc_analyst",
      "ipAddress": "10.0.0.50",
      "targetType": "incident",
      "targetId": "inc-0142",
      "targetName": "SSH Brute Force on web-server-01",
      "details": {
        "previousStatus": "open",
        "newStatus": "investigating"
      },
      "createdAt": "2026-07-18T10:12:05Z"
    },
    {
      "id": "aud-002",
      "action": "rule_create",
      "actorId": "usr-xyz789",
      "actorUsername": "agarcia",
      "actorRole": "security_engineer",
      "ipAddress": "10.0.0.51",
      "targetType": "rule",
      "targetId": "rule-exfil-001",
      "targetName": "Custom Data Exfiltration",
      "details": {
        "ruleType": "match",
        "severity": "high"
      },
      "createdAt": "2026-07-19T10:00:00Z"
    },
    {
      "id": "aud-003",
      "action": "login",
      "actorId": "usr-abc123",
      "actorUsername": "jsmith",
      "actorRole": "soc_analyst",
      "ipAddress": "10.0.0.50",
      "targetType": null,
      "targetId": null,
      "targetName": null,
      "details": {
        "userAgent": "Mozilla/5.0..."
      },
      "createdAt": "2026-07-19T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1500, "totalPages": 30 }
}
```

---

## 10. Configuration

### GET /config

Get all non-sensitive configuration values.

**Access:** Admin only

**Response (200):**

```json
{
  "data": [
    {
      "key": "correlation.time_window_minutes",
      "value": 15,
      "description": "Correlation time window in minutes",
      "isSensitive": false,
      "updatedAt": "2026-07-01T08:00:00Z"
    },
    {
      "key": "scoring.weight_rule",
      "value": 0.30,
      "description": "Risk score weight for rule component",
      "isSensitive": false,
      "updatedAt": "2026-07-01T08:00:00Z"
    },
    {
      "key": "ai.anomaly_threshold",
      "value": 0.65,
      "description": "AI anomaly score threshold",
      "isSensitive": false,
      "updatedAt": "2026-07-18T12:00:00Z"
    }
  ]
}
```

---

### PUT /config/:key

Update a configuration value.

**Access:** Admin only (`ai.anomaly_threshold` also accessible to Security Engineer)

**Request:**

```json
{
  "value": 0.70
}
```

**Response (200):**

```json
{
  "key": "ai.anomaly_threshold",
  "value": 0.70,
  "previousValue": 0.65,
  "updatedAt": "2026-07-19T10:00:00Z",
  "updatedBy": "usr-xyz789"
}
```

---

## 11. AI Engine (Internal)

> [!IMPORTANT]
> These endpoints are exposed by the **Python FastAPI AI Engine** (Process 3) on `http://ai-engine:8000`. They are **not accessible externally** — only the Node.js backend calls them over the Docker internal network. Documented here for completeness.

### POST /detect/anomaly

Batch anomaly detection with optional SHAP explanations.

**Request:**

```json
{
  "events": [
    {
      "event_id": "evt-abc123",
      "features": {
        "hour_of_day": 3,
        "day_of_week": 5,
        "is_business_hours": 0,
        "time_since_last_event": 0.5,
        "time_deviation_score": 2.8,
        "events_per_minute_src_ip": 45,
        "events_per_hour_user": 120,
        "unique_dst_ips_per_src": 1,
        "unique_users_per_src_ip": 3,
        "frequency_deviation": 4.2,
        "src_ip_entropy": 0.0,
        "username_entropy": 1.58,
        "process_name_entropy": 0.0,
        "bytes_sent": 120,
        "bytes_received": 4500,
        "bytes_ratio": 0.027,
        "severity_id": 3,
        "failed_login_count_10min": 38,
        "failed_to_success_ratio": 0.97,
        "new_source_ip": 1
      }
    }
  ],
  "threshold": 0.65,
  "include_shap": true
}
```

**Response (200):**

```json
{
  "predictions": [
    {
      "event_id": "evt-abc123",
      "anomaly_score": 0.89,
      "is_anomaly": true,
      "confidence": 0.92,
      "shap_explanation": {
        "base_value": 0.32,
        "features": [
          { "name": "events_per_minute_src_ip", "value": 45.0, "shap_value": 0.28 },
          { "name": "failed_login_count_10min", "value": 38.0, "shap_value": 0.22 },
          { "name": "is_business_hours", "value": 0.0, "shap_value": 0.15 }
        ]
      }
    }
  ],
  "model_version": "v20260718_120000",
  "processing_time_ms": 45,
  "events_processed": 1,
  "anomalies_detected": 1
}
```

**Error (422):**

```json
{
  "detail": [
    {
      "loc": ["body", "events", 0, "features", "hour_of_day"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**Error (503 — Model not loaded):**

```json
{
  "error": "Model not loaded",
  "detail": "The AI model is still loading. Try again in a few seconds."
}
```

---

### POST /explain

Get SHAP explanation for a single event.

**Request:**

```json
{
  "event_id": "evt-abc123",
  "features": { "...": "same 20 features as detect" }
}
```

**Response (200):**

```json
{
  "event_id": "evt-abc123",
  "anomaly_score": 0.89,
  "shap_explanation": {
    "base_value": 0.32,
    "features": [
      { "name": "events_per_minute_src_ip", "value": 45.0, "shap_value": 0.28 },
      { "name": "failed_login_count_10min", "value": 38.0, "shap_value": 0.22 },
      { "name": "is_business_hours", "value": 0.0, "shap_value": 0.15 },
      { "name": "failed_to_success_ratio", "value": 0.97, "shap_value": 0.12 },
      { "name": "time_deviation_score", "value": 2.8, "shap_value": 0.08 },
      { "name": "new_source_ip", "value": 1.0, "shap_value": 0.06 }
    ]
  },
  "model_version": "v20260718_120000",
  "processing_time_ms": 12
}
```

---

### GET /health

AI Engine health check.

**Response (200):**

```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_version": "v20260718_120000",
  "uptime_seconds": 86423,
  "total_predictions": 1250000,
  "avg_latency_ms": 35,
  "p99_latency_ms": 120,
  "errors_total": 12
}
```

**Response (503 — Unhealthy):**

```json
{
  "status": "unhealthy",
  "model_loaded": false,
  "error": "Failed to load model: file not found"
}
```

---

### GET /metrics

AI Engine performance metrics.

**Response (200):**

```json
{
  "inference": {
    "total_requests": 125000,
    "total_events_processed": 12500000,
    "total_anomalies_detected": 625000,
    "avg_batch_size": 100,
    "avg_latency_ms": 35,
    "p50_latency_ms": 28,
    "p95_latency_ms": 85,
    "p99_latency_ms": 120,
    "error_rate": 0.0001
  },
  "shap": {
    "total_explanations": 625000,
    "avg_explanation_ms": 8
  },
  "model": {
    "version": "v20260718_120000",
    "threshold": 0.65,
    "loaded_at": "2026-07-18T00:00:00Z"
  }
}
```

---

### POST /classify/threat

Optional endpoint for classification (Random Forest / XGBoost).

**Request Body (application/json):**

```json
{
  "features": [
    [10, 3, 1, 300, 1.2, 5, 120, 3, 2, 0.8, 1.4, 2.1, 1.1, 500, 1200, 0.4, 2, 0, 0.0, 0]
  ]
}
```

**Response (200):**

```json
{
  "predictions": [
    {
      "threat_class": "brute_force",
      "confidence": 0.89
    }
  ],
  "model_version": "v20260718_120000_rf",
  "latency_ms": 12
}
```

---

### GET /model/info

Active model version and training metadata.

**Response (200):**

```json
{
  "active_version": "v20260718_120000",
  "threshold": 0.65,
  "feature_count": 20,
  "feature_names": [
    "hour_of_day", "day_of_week", "is_business_hours",
    "time_since_last_event", "time_deviation_score",
    "events_per_minute_src_ip", "events_per_hour_user",
    "unique_dst_ips_per_src", "unique_users_per_src_ip",
    "frequency_deviation",
    "src_ip_entropy", "username_entropy", "process_name_entropy",
    "bytes_sent", "bytes_received", "bytes_ratio",
    "severity_id",
    "failed_login_count_10min", "failed_to_success_ratio",
    "new_source_ip"
  ],
  "training_metadata": {
    "trained_at": "2026-07-18T12:00:00Z",
    "training_samples": 800000,
    "holdout_samples": 200000,
    "n_estimators": 200,
    "anomaly_rate_at_threshold": 0.05
  },
  "available_versions": [
    "v20260718_120000",
    "v20260701_080000"
  ]
}
```

---

## Endpoint Summary

| Group | Method | Endpoint | Access |
|---|---|---|---|
| **Auth** | POST | `/auth/login` | Public |
| | POST | `/auth/logout` | All |
| | POST | `/auth/refresh` | All |
| | GET | `/auth/me` | All |
| **Dashboard** | GET | `/dashboard/summary` | All |
| | GET | `/dashboard/timeline` | All |
| | GET | `/dashboard/top-assets` | All |
| | GET | `/dashboard/source-breakdown` | All |
| **Incidents** | GET | `/incidents` | All |
| | GET | `/incidents/:id` | All |
| | GET | `/incidents/:id/alerts` | All |
| | GET | `/incidents/:id/timeline` | All |
| | GET | `/incidents/:id/events` | All |
| | GET | `/incidents/:id/context` | All |
| | PUT | `/incidents/:id/status` | All |
| | PUT | `/incidents/:id/assign` | Admin, Engineer |
| | POST | `/incidents/:id/notes` | All |
| | PUT | `/incidents/:id/resolve` | All |
| **Events** | GET | `/events/search` | All |
| | GET | `/events/:eventId` | All |
| | GET | `/events/export` | All |
| **Rules** | GET | `/rules` | All |
| | GET | `/rules/:id` | All |
| | POST | `/rules` | Admin, Engineer |
| | PUT | `/rules/:id` | Admin, Engineer |
| | DELETE | `/rules/:id` | Admin |
| | PUT | `/rules/:id/enable` | Admin, Engineer |
| | PUT | `/rules/:id/disable` | Admin, Engineer |
| | POST | `/rules/:id/test` | All |
| | POST | `/rules/import` | Admin, Engineer |
| | GET | `/rules/export` | All |
| **Collector** | GET | `/collector/status` | All |
| | GET | `/collector/quarantine` | Admin, Engineer |
| | POST | `/collector/quarantine/:file/retry` | Admin, Engineer |
| **Users** | GET | `/users` | Admin |
| | GET | `/users/:id` | Admin |
| | POST | `/users` | Admin |
| | PUT | `/users/:id` | Admin |
| | PUT | `/users/:id/deactivate` | Admin |
| | PUT | `/users/:id/reset-password` | Admin |
| **Assets** | GET | `/assets` | All |
| | GET | `/assets/:id` | All |
| | POST | `/assets` | Admin, Engineer |
| | PUT | `/assets/:id` | Admin, Engineer |
| | DELETE | `/assets/:id` | Admin |
| **Audit** | GET | `/audit` | Admin, Engineer |
| **Config** | GET | `/config` | Admin |
| | PUT | `/config/:key` | Admin |
| **AI (Internal)** | POST | `/detect/anomaly` | Internal |
| | POST | `/explain` | Internal |
| | POST | `/classify/threat` | Internal |
| | GET | `/health` | Internal |
| | GET | `/metrics` | Internal |
| | GET | `/model/info` | Internal |

**Total: 48 endpoints** (44 backend + 4 AI Engine internal)

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). All backend endpoints are served by the Node.js Express application on port 3000. AI Engine endpoints are served by Python FastAPI on port 8000 (internal only). Authentication uses JWT tokens stored in httpOnly cookies. Role-based access is enforced at both the API layer and the frontend UI layer (see [FRONTEND-001](file:///d:/AI%20SIEM/docs/frontend.md)).**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-19
