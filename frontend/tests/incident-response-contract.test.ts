import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { incidentAssignmentMutationSchema, incidentNoteMutationSchema, incidentResolutionMutationSchema, incidentStatusMutationSchema } from "../src/services/api/incident-schemas";
import { managedUserPageSchema } from "../src/services/api/user-schemas";
import { roleHasPermission } from "../src/utils/permissions";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const USER_ID = "00000000-0000-4000-8000-000000000601";
const UPDATED_AT = "2026-11-11T06:00:00.000Z";

test("FE-02C validates and allowlists every incident mutation response", () => {
  assert.deepEqual(incidentStatusMutationSchema.parse({ id: INCIDENT_ID, status: "investigating", updatedAt: UPDATED_AT, orgId: "discarded" }), { id: INCIDENT_ID, status: "investigating", updatedAt: UPDATED_AT });
  assert.deepEqual(incidentAssignmentMutationSchema.parse({ id: INCIDENT_ID, assignedTo: USER_ID, updatedAt: UPDATED_AT, assigneeEmail: "discarded@example.com" }), { id: INCIDENT_ID, assignedTo: USER_ID, updatedAt: UPDATED_AT });
  const note = incidentNoteMutationSchema.parse({ id: "00000000-0000-4000-8000-000000000701", incidentId: INCIDENT_ID, authorId: USER_ID, authorName: "analyst", content: "Reviewed authentication evidence.", createdAt: UPDATED_AT, orgId: "discarded" });
  assert.equal(note.content, "Reviewed authentication evidence.");
  assert.equal("orgId" in note, false);
  const resolution = incidentResolutionMutationSchema.parse({ id: INCIDENT_ID, status: "resolved", resolution: "tp_mitigated", resolvedAt: UPDATED_AT, updatedAt: UPDATED_AT, note: "discarded" });
  assert.equal(resolution.resolution, "tp_mitigated");
  assert.equal("note" in resolution, false);
});

test("FE-02C rejects unsupported resolution and malformed mutation identities", () => {
  assert.equal(incidentResolutionMutationSchema.safeParse({ id: INCIDENT_ID, status: "resolved", resolution: "other", resolvedAt: UPDATED_AT, updatedAt: UPDATED_AT }).success, false);
  assert.equal(incidentAssignmentMutationSchema.safeParse({ id: INCIDENT_ID, assignedTo: "default", updatedAt: UPDATED_AT }).success, false);
  assert.equal(incidentNoteMutationSchema.safeParse({ id: USER_ID, incidentId: INCIDENT_ID, authorId: USER_ID, authorName: "analyst", content: "", createdAt: UPDATED_AT }).success, false);
});

test("FE-02C allows assignment controls only for backend-aligned roles", () => {
  assert.equal(roleHasPermission("admin", "incidents.assign"), true);
  assert.equal(roleHasPermission("security_engineer", "incidents.assign"), true);
  assert.equal(roleHasPermission("soc_analyst", "incidents.assign"), false);
});

test("FE-02C validates the administrator-only active user directory", () => {
  const page = managedUserPageSchema.parse({ data: [{ id: USER_ID, username: "analyst", email: "analyst@example.com", role: "soc_analyst", displayName: "SOC Analyst", isActive: true, lastLoginAt: null, createdAt: UPDATED_AT, passwordHash: "discarded" }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false }, orgId: "discarded" });
  assert.equal(page.data[0]?.displayName, "SOC Analyst");
  assert.equal("passwordHash" in page.data[0]!, false);
  assert.equal("orgId" in page, false);
});

test("FE-02C uses only documented transactional endpoints and no tenant override", async () => {
  const source = await readFile(resolve(process.cwd(), "src/services/api/incidents.ts"), "utf8");
  assert.match(source, /\/status/u);
  assert.match(source, /\/assign/u);
  assert.match(source, /\/notes/u);
  assert.match(source, /\/resolve/u);
  assert.doesNotMatch(source, /orgId|tenantId/u);
});
