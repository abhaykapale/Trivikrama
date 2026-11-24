import assert from "node:assert/strict";
import test from "node:test";
import { eventDetailSchema, eventSearchSchema } from "../src/services/api/event-schemas";
import { eventParameters, eventSearchString, parseEventQuery, validEventId } from "../src/utils/event-query";

const event = { eventId: "sha256:abc", classUid: 3002, categoryUid: 3, severityId: 3, time: "2026-11-11T06:00:00.000Z", message: "Failed login", metadata: { version: "1.1.0" }, ingestion: { batchId: "b1", collectorId: "c1", ingestedAt: "2026-11-11T06:00:01.000Z" } };
test("FE-03A restores allowlisted URL filters and ignores tenant overrides", () => {
  const query = parseEventQuery(new URLSearchParams("srcIp=203.0.113.1&page=2&severityId=4&orgId=other&sort=severityId&order=asc"));
  assert.deepEqual(eventParameters(query), { srcIp: "203.0.113.1", severityId: "4", page: 2, limit: 50, sort: "severityId", order: "asc" });
  assert.equal(eventSearchString(query).includes("orgId"), false);
  assert.deepEqual(parseEventQuery(new URLSearchParams("page=-1&classUid=-1&severityId=9&from=bad")).filters, {});
});
test("FE-03A validates contract event IDs without accepting path injection", () => {
  assert.equal(validEventId("sha256:abc-def"), true);
  assert.equal(validEventId("../../admin"), false);
  assert.equal(validEventId("a".repeat(257)), false);
});
test("FE-03A validates event pages and strips unlisted top-level fields", () => {
  const response = eventSearchSchema.parse({ data: [{ ...event, orgId: "secret", rawPayload: "private" }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasNext: false, hasPrev: false }, window: { from: event.time, to: event.time } });
  assert.equal("orgId" in response.data[0]!, false);
  assert.equal("rawPayload" in response.data[0]!, false);
  assert.equal(eventDetailSchema.safeParse({ ...event, severityId: 8, aiAnalysis: null }).success, false);
});
test("FE-03A preserves real AI and SHAP evidence and fallback flags", () => {
  const detail = eventDetailSchema.parse({ ...event, aiAnalysis: { modelName: "isolation-forest", modelVersion: "v1", anomalyScore: .9, isAnomaly: true, usedFallback: false, createdAt: event.time, shapExplanation: { features: [{ name: "failed_login_count_10min", value: 10, shapValue: .23 }] } } });
  assert.equal(detail.aiAnalysis?.shapExplanation?.features[0]?.shapValue, .23);
  assert.equal(detail.aiAnalysis?.usedFallback, false);
});
