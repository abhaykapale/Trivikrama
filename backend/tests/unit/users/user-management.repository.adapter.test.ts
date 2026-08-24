import test from "node:test";
import assert from "node:assert/strict";

import type { IUserRepository, UserRecord } from "../../../src/database/repositories/users/user.repository.js";
import { UserManagementRepositoryAdapter } from "../../../src/modules/users/infrastructure/user-management.repository.adapter.js";

test("passes filters and pagination to list and filters to count", async () => {
  let receivedListFilters;
  let receivedCountFilters;

  const databaseUser: UserRecord = {
    id: "user-1",
    username: "abhay",
    email: "abhay@example.com",
    passwordHash: "hashed-password",
    role: "admin",
    displayName: "Abhay",
    isActive: true,
    lastLoginAt: new Date("2026-08-20T10:00:00.000Z"),
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    orgId: "org-123",
  };

  const repository: Pick<IUserRepository, "list" | "count" | "findById"> = {
    list: async (filters) => {
      receivedListFilters = filters;

      return {
        items: [databaseUser],
        total: 1,
        limit: 10,
        offset: 20,
        hasMore: false,
      };
    },

    count: async (filters) => {
      receivedCountFilters = filters;
      return 25;
    },
    findById: async () => null
  };

  const adapter = new UserManagementRepositoryAdapter(repository);

  const result = await adapter.list({
    orgId: "org-123",
    role: "admin",
    isActive: true,
    search: "abhay",
    limit: 10,
    offset: 20,
  });

  assert.deepEqual(receivedListFilters, {
    orgId: "org-123",
    role: "admin",
    isActive: true,
    search: "abhay",
    limit: 10,
    offset: 20,
  });

  assert.deepEqual(receivedCountFilters, {
    orgId: "org-123",
    role: "admin",
    isActive: true,
    search: "abhay",
  });

  assert.equal(result.total, 25);
});

test("maps database user to managed user without persistence-only fields", async () => {
  const databaseUser: UserRecord = {
    id: "user-1",
    username: "abhay",
    email: "abhay@example.com",
    passwordHash: "hashed-password",
    role: "admin",
    displayName: "Abhay",
    isActive: true,
    lastLoginAt: new Date("2026-08-20T10:00:00.000Z"),
    failedLoginCount: 3,
    lockedUntil: new Date("2026-08-21T10:00:00.000Z"),
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
    updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    orgId: "org-123",
  };

  const repository: Pick<IUserRepository, "list" | "count" | "findById" > = {
    list: async () => ({
      items: [databaseUser],
      total: 1,
      limit: 10,
      offset: 0,
      hasMore: false,
    }),

    count: async () => 1,
    findById: async () => null,
  };

  const adapter = new UserManagementRepositoryAdapter(repository);

  const result = await adapter.list({
    orgId: "org-123",
    limit: 10,
    offset: 0,
  });

  const returnedUser = result.items[0];

  assert.ok(returnedUser);

  assert.deepEqual(returnedUser, {
    id: "user-1",
    username: "abhay",
    email: "abhay@example.com",
    role: "admin",
    displayName: "Abhay",
    isActive: true,
    lastLoginAt: new Date("2026-08-20T10:00:00.000Z"),
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
  });

  assert.equal("passwordHash" in returnedUser, false);
  assert.equal("failedLoginCount" in returnedUser, false);
  assert.equal("lockedUntil" in returnedUser, false);
  assert.equal("orgId" in returnedUser, false);
  assert.equal("updatedAt" in returnedUser, false);
});

test("returns empty items when no users match", async () => {
  const repository: Pick<IUserRepository, "list" | "count" | "findById"> = {
    list: async () => ({
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
      hasMore: false,
    }),

    count: async () => 0,
    findById: async () => null,
  };

  const adapter = new UserManagementRepositoryAdapter(repository);

  const result = await adapter.list({
    orgId: "org-123",
    limit: 10,
    offset: 0,
  });

  assert.deepEqual(result, {
    items: [],
    total: 0,
  });
});

test("propagates repository errors", async () => {
  const repository: Pick<IUserRepository, "list" | "count" | "findById"> = {
    list: async () => {
      throw new Error("Database connection failed");
    },

    count: async () => 0,
    findById: async () => null,
  };

  const adapter = new UserManagementRepositoryAdapter(repository);

  await assert.rejects(
    () =>
      adapter.list({
        orgId: "org-123",
        limit: 10,
        offset: 0,
      }),
    {
      message: "Database connection failed",
    },
  );
});


