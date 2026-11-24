import assert from "node:assert/strict";
import test from "node:test";
import { incidentQueuePageSchema } from "../src/services/api/incident-schemas";
import { buildIncidentQueueSearch, countIncidentFilters, parseIncidentQueueQuery, toIncidentApiParameters } from "../src/utils/incident-query";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000502";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000601";

test("FE-02A validates and allowlists the incident queue response", () => {
  const result = incidentQueuePageSchema.parse({
    data: [{
      id: INCIDENT_ID,
      title: "Repeated failed administrator authentication",
      description: null,
      status: "investigating",
      severity: "high",
      riskScore: 84.5,
      source: "both",
      primaryEntity: "203.0.113.251",
      entityType: "ip_address",
      alertCount: 2,
      eventCount: 10,
      assignedTo: ASSIGNEE_ID,
      firstEventAt: "2026-11-10T10:00:00.000Z",
      lastEventAt: "2026-11-10T10:04:00.000Z",
      createdAt: "2026-11-10T10:05:00.000Z",
      updatedAt: "2026-11-10T10:06:00.000Z",
      scoreBreakdown: { confidentialInternalValue: 0.91 },
      orgId: "must-not-reach-the-view",
    }],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
  });

  assert.equal(result.data[0]?.eventCount, 10);
  assert.equal("orgId" in result.data[0]!, false);
  assert.equal("scoreBreakdown" in result.data[0]!, false);
});

test("FE-02A rejects invalid incident identities, scores, and pagination", () => {
  const invalid = incidentQueuePageSchema.safeParse({
    data: [{
      id: "not-an-incident-id",
      title: "Invalid",
      description: null,
      status: "open",
      severity: "high",
      riskScore: 101,
      source: "rule",
      primaryEntity: null,
      entityType: null,
      alertCount: 0,
      eventCount: 0,
      assignedTo: null,
      firstEventAt: null,
      lastEventAt: null,
      createdAt: "invalid",
      updatedAt: "invalid",
    }],
    pagination: { page: 0, limit: 101, total: -1, totalPages: 0, hasNext: false, hasPrev: false },
  });

  assert.equal(invalid.success, false);
});

test("FE-02A parses only supported URL filters and applies safe defaults", () => {
  const parsed = parseIncidentQueueQuery(new URLSearchParams({
    page: "3",
    status: "investigating",
    severity: "critical",
    source: "both",
    assignedTo: ASSIGNEE_ID,
    search: "  administrator  ",
    range: "7d",
    sort: "riskScore",
    order: "asc",
  }));

  assert.deepEqual(parsed, {
    page: 3,
    status: "investigating",
    severity: "critical",
    source: "both",
    assignedTo: ASSIGNEE_ID,
    search: "administrator",
    timeRange: "7d",
    sort: "riskScore",
    order: "asc",
  });

  const safe = parseIncidentQueueQuery(new URLSearchParams({ page: "-8", status: "deleted", assignedTo: "default", range: "forever", sort: "tenant", order: "random" }));
  assert.deepEqual(safe, { page: 1, timeRange: "24h", sort: "createdAt", order: "desc" });
});

test("FE-02A produces backend-aligned parameters without tenant input", () => {
  const query = parseIncidentQueueQuery(new URLSearchParams({ severity: "high", search: "host-01", range: "4h" }));
  const result = toIncidentApiParameters(query, Date.parse("2026-11-10T12:00:00.000Z"));

  assert.deepEqual(result, {
    page: 1,
    limit: 25,
    sort: "createdAt",
    order: "desc",
    severity: "high",
    search: "host-01",
    from: "2026-11-10T08:00:00.000Z",
  });
  assert.equal("orgId" in result, false);
});

test("FE-02A serializes canonical shareable queue state", () => {
  const query = parseIncidentQueueQuery(new URLSearchParams({ page: "2", status: "open", search: "SSH", range: "all", sort: "updatedAt", order: "asc" }));
  const search = buildIncidentQueueSearch(query);
  assert.equal(search, "page=2&status=open&search=SSH&range=all&sort=updatedAt&order=asc");
  assert.equal(countIncidentFilters(query), 3);
});
