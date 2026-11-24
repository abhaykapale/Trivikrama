import assert from "node:assert/strict";
import test from "node:test";
import { currentUserResponseSchema, loginResponseSchema, refreshResponseSchema } from "../src/services/api/schemas";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "admin_user",
  email: "admin@example.test",
  role: "admin",
  displayName: "Admin User",
  lastLoginAt: "2026-11-09T00:00:00.000Z",
};

test("login contract drops the returned JWT from frontend session state", () => {
  const result = loginResponseSchema.parse({
    token: "must-not-be-persisted",
    user,
    expiresAt: "2026-11-09T01:00:00.000Z",
  });

  assert.deepEqual(result, { user, expiresAt: "2026-11-09T01:00:00.000Z" });
  assert.equal("token" in result, false);
});

test("refresh contract exposes only safe expiry metadata", () => {
  const result = refreshResponseSchema.parse({ token: "discard-me", expiresAt: "2026-11-09T02:00:00.000Z" });
  assert.deepEqual(result, { expiresAt: "2026-11-09T02:00:00.000Z" });
});

test("current-user contract keeps only shell-safe user fields", () => {
  const result = currentUserResponseSchema.parse({ user: { ...user, isActive: true, createdAt: "2026-01-01T00:00:00Z" } });
  assert.deepEqual(result.user, user);
});
