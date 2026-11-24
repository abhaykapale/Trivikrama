import assert from "node:assert/strict";
import test from "node:test";
import { getCookieValue } from "../src/utils/cookies";
import { getSafeReturnPath } from "../src/utils/navigation";
import { calculateRefreshDelay } from "../src/utils/session";
import { isUnsafeHttpMethod } from "../src/utils/http-security";

test("cookie parser returns the exact decoded CSRF cookie", () => {
  assert.equal(getCookieValue("theme=dark; siem_csrf=a%2Fb%2Bc; other=1", "siem_csrf"), "a/b+c");
  assert.equal(getCookieValue("siem_csrf_extra=wrong", "siem_csrf"), null);
});

test("return paths reject external and backslash navigation", () => {
  assert.equal(getSafeReturnPath("/incidents"), "/incidents");
  assert.equal(getSafeReturnPath("//evil.example"), "/");
  assert.equal(getSafeReturnPath("/\\evil.example"), "/");
  assert.equal(getSafeReturnPath("https://evil.example"), "/");
});

test("CSRF protection is selected only for unsafe HTTP methods", () => {
  assert.equal(isUnsafeHttpMethod("POST"), true);
  assert.equal(isUnsafeHttpMethod("patch"), true);
  assert.equal(isUnsafeHttpMethod("DELETE"), true);
  assert.equal(isUnsafeHttpMethod("GET"), false);
  assert.equal(isUnsafeHttpMethod("HEAD"), false);
  assert.equal(isUnsafeHttpMethod(undefined), false);
});

test("refresh is scheduled inside the backend five-minute window", () => {
  const now = Date.parse("2026-11-09T00:00:00.000Z");
  const expiry = "2026-11-09T01:00:00.000Z";
  assert.equal(calculateRefreshDelay(expiry, now), 3_315_000);
  assert.equal(calculateRefreshDelay("invalid", now), null);
  assert.equal(calculateRefreshDelay("2026-11-08T23:59:59.000Z", now), null);
});
