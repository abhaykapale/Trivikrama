import assert from "node:assert/strict";
import test from "node:test";
import { formatCount, formatMinutes, formatRelativeTime, formatSeverity, formatSource, formatTrend } from "../src/utils/dashboard-formatters";

test("dashboard metric formatters remain compact and deterministic", () => {
  assert.equal(formatCount(9999), "9,999");
  assert.match(formatCount(12500), /12\.5K/iu);
  assert.equal(formatMinutes(30), "30m");
  assert.equal(formatMinutes(90), "1.5h");
  assert.equal(formatTrend(-12.5), "-12.5%");
  assert.equal(formatSeverity("informational"), "Info");
  assert.equal(formatSource("windows_event-log"), "Windows Event Log");
});

test("relative timestamps use operationally useful units", () => {
  const now = Date.parse("2026-11-10T01:00:00.000Z");
  assert.equal(formatRelativeTime("2026-11-10T00:59:50.000Z", now), "Just now");
  assert.equal(formatRelativeTime("2026-11-10T00:45:00.000Z", now), "15m ago");
  assert.equal(formatRelativeTime("2026-11-09T23:00:00.000Z", now), "2h ago");
});
