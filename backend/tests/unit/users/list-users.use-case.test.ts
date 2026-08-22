import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  IUserManagementRepository,
  ManagedUserFilters,
  ManagedUserRecord,
  PageResult,
} from "../../../src/modules/users/domain/user-management.contracts.js";

import { ListUsersUseCase } from "../../../src/modules/users/application/use-case/list-users.use-case";
import { fail } from "node:assert";

class FakeUserManagementRepository implements IUserManagementRepository {
  public receivedFilters: ManagedUserFilters | null = null;

  public constructor(private readonly result: PageResult<ManagedUserRecord>) {}

  async list(filters: ManagedUserFilters): Promise<PageResult<ManagedUserRecord>> {
    this.receivedFilters = filters;
    return this.result
  }
}

test("lists users with mapped filters, DTOs, and pagination", async () => {
  // Arrange
  const createdAt = new Date("2026-08-01T10:00:00.000Z");

  const repository = new FakeUserManagementRepository({
    items: [
      {
        id: "user-1",
        username: "analyst",
        email: "analyst@example.com",
        role: "soc_analyst",
        displayName: null,
        isActive: false,
        lastLoginAt: null,
        createdAt,
      },
    ],
    total: 51,
  });

  const useCase = new ListUsersUseCase(repository);

  // Act
  const response = await useCase.execute({
    orgId: "org-123",
    page: 2,
    limit: 25,
    role: "soc_analyst",
    isActive: false,
    search: "  analyst  ",
  });

  // Assert: repository input
  assert.deepEqual(repository.receivedFilters, {
    orgId: "org-123",
    limit: 25,
    offset: 25,
    role: "soc_analyst",
    isActive: false,
    search: "analyst",
  });

  // Assert: returned DTO
  assert.deepEqual(response.data, [
    {
      id: "user-1",
      username: "analyst",
      email: "analyst@example.com",
      role: "soc_analyst",
      displayName: null,
      isActive: false,
      lastLoginAt: null,
      createdAt: "2026-08-01T10:00:00.000Z",
    },
  ]);

  // Assert: pagination
  assert.deepEqual(response.pagination, {
    page: 2,
    limit: 25,
    total: 51,
    totalPages: 3,
    hasNext: true,
    hasPrev: true,
  });
});

test("returns empty pagination when no users match", async () => {

  // Arrange

  const repository = new FakeUserManagementRepository({
    items: [],
    total: 0,
  });

  const useCase = new ListUsersUseCase(repository);

  // Act
  const response = await useCase.execute({
    orgId: "org-123",
    page: 1,
    limit: 25,
  });

  // Assert: repository input
  assert.deepEqual(repository.receivedFilters, {
    orgId: "org-123",
    limit: 25,
    offset: 0,
    role: undefined,
    isActive: undefined,
    search: undefined,
  });

  // Assert: returned DTO
  assert.deepEqual(response.data, []);

  // Assert: pagination
  assert.deepEqual(response.pagination, {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
});
