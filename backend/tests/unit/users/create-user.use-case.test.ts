import assert from "node:assert/strict";
import { test } from "node:test";

import AppError from "../../../src/shared/errors/AppError.js";
import { CreateUserUseCase } from "../../../src/modules/users/application/use-case/create-user.use-case.js";
import {
  UserUniquenessConflictError,
  type CreatedManagedUser,
  type CreateManagedUserRepositoryInput,
  type IUserCreationAuditWriter,
  type IUserCreationRepository,
  type IUserCreationUnitOfWork,
  type PasswordHasher,
  type UserCreationTransactionContext,
  type UserCreatedAuditInput,
} from "../../../src/modules/users/domain/user-creation.contracts.js";

const CREATED_USER: CreatedManagedUser = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  username: "agarcia",
  email: "agarcia@corp.local",
  role: "security_engineer",
  displayName: "Ana Garcia",
  isActive: true,
  createdAt: new Date("2026-08-26T10:00:00.000Z"),
};

class FakeUserCreationRepository implements IUserCreationRepository {
  public existingUsername = false;
  public existingEmail = false;
  public createError: Error | null = null;
  public createdUser = CREATED_USER;
  public readonly usernameLookups: Array<{
    readonly username: string;
    readonly orgId: string;
  }> = [];
  public readonly emailLookups: Array<{
    readonly email: string;
    readonly orgId: string;
  }> = [];
  public readonly createInputs: CreateManagedUserRepositoryInput[] = [];

  public async usernameExists(
    username: string,
    orgId: string,
  ): Promise<boolean> {
    this.usernameLookups.push({ username, orgId });
    return this.existingUsername;
  }

  public async emailExists(email: string, orgId: string): Promise<boolean> {
    this.emailLookups.push({ email, orgId });
    return this.existingEmail;
  }

  public async createUser(
    input: CreateManagedUserRepositoryInput,
  ): Promise<CreatedManagedUser> {
    this.createInputs.push(input);

    if (this.createError !== null) {
      throw this.createError;
    }

    return this.createdUser;
  }
}

class FakePasswordHasher implements PasswordHasher {
  public readonly receivedPasswords: string[] = [];

  public async hash(password: string): Promise<string> {
    this.receivedPasswords.push(password);
    return "bcrypt-hash";
  }
}

class FakeAuditWriter implements IUserCreationAuditWriter {
  public readonly inputs: UserCreatedAuditInput[] = [];

  public async recordUserCreated(input: UserCreatedAuditInput): Promise<void> {
    this.inputs.push(input);
  }
}

class FakeUnitOfWork implements IUserCreationUnitOfWork {
  public executionCount = 0;

  public constructor(
    private readonly users: IUserCreationRepository,
    private readonly audit: IUserCreationAuditWriter,
  ) {}

  public async execute<TResult>(
    operation: (
      context: UserCreationTransactionContext,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    this.executionCount += 1;
    return operation({ users: this.users, audit: this.audit });
  }
}

function createHarness(): {
  readonly useCase: CreateUserUseCase;
  readonly users: FakeUserCreationRepository;
  readonly hasher: FakePasswordHasher;
  readonly audit: FakeAuditWriter;
  readonly unitOfWork: FakeUnitOfWork;
} {
  const users = new FakeUserCreationRepository();
  const hasher = new FakePasswordHasher();
  const audit = new FakeAuditWriter();
  const unitOfWork = new FakeUnitOfWork(users, audit);

  return {
    useCase: new CreateUserUseCase(users, hasher, unitOfWork),
    users,
    hasher,
    audit,
    unitOfWork,
  };
}

function command() {
  return {
    username: "  agarcia  ",
    email: "  AGARCIA@CORP.LOCAL  ",
    password: "InitialP@ss123!",
    role: "security_engineer" as const,
    displayName: "  Ana Garcia  ",
    orgId: "org-123",
    actorId: "550e8400-e29b-41d4-a716-446655440001",
    actorUsername: "admin",
    actorRole: "admin" as const,
    ipAddress: "127.0.0.1",
  };
}

test("CreateUserUseCase hashes, creates and audits a safe user", async () => {
  const harness = createHarness();

  const result = await harness.useCase.execute(command());

  assert.deepEqual(harness.users.usernameLookups, [
    { username: "agarcia", orgId: "org-123" },
  ]);
  assert.deepEqual(harness.users.emailLookups, [
    { email: "agarcia@corp.local", orgId: "org-123" },
  ]);
  assert.deepEqual(harness.hasher.receivedPasswords, ["InitialP@ss123!"]);
  assert.deepEqual(harness.users.createInputs, [
    {
      username: "agarcia",
      email: "agarcia@corp.local",
      passwordHash: "bcrypt-hash",
      role: "security_engineer",
      displayName: "Ana Garcia",
      orgId: "org-123",
    },
  ]);
  assert.equal(harness.unitOfWork.executionCount, 1);
  assert.equal(harness.audit.inputs.length, 1);
  assert.equal(harness.audit.inputs[0]?.actorId, command().actorId);
  assert.equal(harness.audit.inputs[0]?.user.id, CREATED_USER.id);
  assert.deepEqual(result, {
    id: CREATED_USER.id,
    username: "agarcia",
    email: "agarcia@corp.local",
    role: "security_engineer",
    displayName: "Ana Garcia",
    isActive: true,
    createdAt: "2026-08-26T10:00:00.000Z",
  });
  assert.equal("password" in result, false);
  assert.equal("passwordHash" in result, false);
});

test("CreateUserUseCase returns USERNAME_EXISTS before hashing", async () => {
  const harness = createHarness();
  harness.users.existingUsername = true;

  await assert.rejects(
    harness.useCase.execute(command()),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.errorCode === "USERNAME_EXISTS",
  );

  assert.deepEqual(harness.hasher.receivedPasswords, []);
  assert.equal(harness.unitOfWork.executionCount, 0);
});

test("CreateUserUseCase returns EMAIL_EXISTS before hashing", async () => {
  const harness = createHarness();
  harness.users.existingEmail = true;

  await assert.rejects(
    harness.useCase.execute(command()),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.errorCode === "EMAIL_EXISTS",
  );

  assert.deepEqual(harness.hasher.receivedPasswords, []);
  assert.equal(harness.unitOfWork.executionCount, 0);
});

test("CreateUserUseCase maps a concurrent unique violation to 409", async () => {
  const harness = createHarness();
  harness.users.createError = new UserUniquenessConflictError("username");

  await assert.rejects(
    harness.useCase.execute(command()),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.errorCode === "USERNAME_EXISTS",
  );

  assert.equal(harness.audit.inputs.length, 0);
});

test("CreateUserUseCase preserves unexpected failures", async () => {
  const harness = createHarness();
  const databaseError = new Error("database details must stay private");
  harness.users.createError = databaseError;

  await assert.rejects(harness.useCase.execute(command()), databaseError);
  assert.equal(harness.audit.inputs.length, 0);
});
