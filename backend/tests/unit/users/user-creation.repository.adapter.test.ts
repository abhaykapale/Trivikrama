import assert from "node:assert/strict";
import { test } from "node:test";

import type { UserRecord } from "../../../src/database/index.js";
import {
  UserUniquenessConflictError,
  type CreateManagedUserRepositoryInput,
} from "../../../src/modules/users/domain/user-creation.contracts.js";
import { UserCreationRepositoryAdapter } from "../../../src/modules/users/infrastructure/user-creation.repository.adapter.js";

const USER: UserRecord = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  username: "agarcia",
  email: "agarcia@corp.local",
  passwordHash: "bcrypt-hash",
  role: "security_engineer",
  displayName: "Ana Garcia",
  isActive: true,
  lastLoginAt: null,
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: new Date("2026-08-26T10:00:00.000Z"),
  updatedAt: new Date("2026-08-26T10:00:00.000Z"),
  orgId: "org-123",
};

class FakePersistence {
  public usernameResult: UserRecord | null = null;
  public emailResult: UserRecord | null = null;
  public createError: unknown = null;
  public readonly usernameInputs: Array<readonly [string, string | undefined]> = [];
  public readonly emailInputs: Array<readonly [string, string | undefined]> = [];
  public readonly createInputs: Array<{
    readonly username: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly role: "admin" | "security_engineer" | "soc_analyst";
    readonly displayName?: string | null;
    readonly isActive?: boolean;
    readonly orgId?: string;
  }> = [];

  public async findByUsername(
    username: string,
    orgId?: string,
  ): Promise<UserRecord | null> {
    this.usernameInputs.push([username, orgId]);
    return this.usernameResult;
  }

  public async findByEmail(
    email: string,
    orgId?: string,
  ): Promise<UserRecord | null> {
    this.emailInputs.push([email, orgId]);
    return this.emailResult;
  }

  public async create(
    input: (typeof this.createInputs)[number],
  ): Promise<UserRecord> {
    this.createInputs.push(input);

    if (this.createError !== null) {
      throw this.createError;
    }

    return USER;
  }
}

const CREATE_INPUT: CreateManagedUserRepositoryInput = {
  username: "agarcia",
  email: "agarcia@corp.local",
  passwordHash: "bcrypt-hash",
  role: "security_engineer",
  displayName: "Ana Garcia",
  orgId: "org-123",
};

test("UserCreationRepositoryAdapter scopes uniqueness checks by organization", async () => {
  const persistence = new FakePersistence();
  const adapter = new UserCreationRepositoryAdapter(persistence);

  assert.equal(await adapter.usernameExists("agarcia", "org-123"), false);
  assert.equal(
    await adapter.emailExists("agarcia@corp.local", "org-123"),
    false,
  );
  assert.deepEqual(persistence.usernameInputs, [["agarcia", "org-123"]]);
  assert.deepEqual(persistence.emailInputs, [
    ["agarcia@corp.local", "org-123"],
  ]);
});

test("UserCreationRepositoryAdapter creates an active user without exposing its hash", async () => {
  const persistence = new FakePersistence();
  const adapter = new UserCreationRepositoryAdapter(persistence);

  const result = await adapter.createUser(CREATE_INPUT);

  assert.deepEqual(persistence.createInputs, [
    {
      ...CREATE_INPUT,
      isActive: true,
    },
  ]);
  assert.deepEqual(result, {
    id: USER.id,
    username: USER.username,
    email: USER.email,
    role: USER.role,
    displayName: USER.displayName,
    isActive: USER.isActive,
    createdAt: USER.createdAt,
  });
  assert.equal("passwordHash" in result, false);
});

test("UserCreationRepositoryAdapter maps username unique violations", async () => {
  const persistence = new FakePersistence();
  persistence.createError = {
    code: "23505",
    constraint: "uq_users_username_org",
  };
  const adapter = new UserCreationRepositoryAdapter(persistence);

  await assert.rejects(
    adapter.createUser(CREATE_INPUT),
    (error: unknown) =>
      error instanceof UserUniquenessConflictError &&
      error.field === "username",
  );
});

test("UserCreationRepositoryAdapter maps email unique violations", async () => {
  const persistence = new FakePersistence();
  persistence.createError = {
    code: "23505",
    constraint: "uq_users_email_org",
  };
  const adapter = new UserCreationRepositoryAdapter(persistence);

  await assert.rejects(
    adapter.createUser(CREATE_INPUT),
    (error: unknown) =>
      error instanceof UserUniquenessConflictError && error.field === "email",
  );
});

test("UserCreationRepositoryAdapter preserves unexpected database failures", async () => {
  const persistence = new FakePersistence();
  const databaseError = new Error("database unavailable");
  persistence.createError = databaseError;
  const adapter = new UserCreationRepositoryAdapter(persistence);

  await assert.rejects(adapter.createUser(CREATE_INPUT), databaseError);
});
