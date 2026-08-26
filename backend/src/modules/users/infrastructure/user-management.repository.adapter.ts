
import type { IUserRepository } from "../../../database";
import type { UserListFilters,UserFilterCriteria, } from "../../../database";
import { DeactivateUserByIdInput } from "../domain/user-management.contracts";
import type { DeactivatedUser, GetManagedUserInput, IUserManagementRepository, ManagedUserFilters, ManagedUserRecord, PageResult } from "../domain/user-management.contracts";


type UserManagementPersistence = Pick<
  IUserRepository,
  "list" | "count" | "findById" | "deactivate"
>;



export class UserManagementRepositoryAdapter implements IUserManagementRepository {
  public constructor(
    private readonly userRepository: UserManagementPersistence,
  ) {}

  public async list(
    filters: ManagedUserFilters,
  ): Promise<PageResult<ManagedUserRecord>> {
    const listFilter: UserListFilters = {
      orgId: filters.orgId,
      role: filters.role,
      isActive: filters.isActive,
      search: filters.search,
      limit: filters.limit,
      offset: filters.offset,
    };

    const dbFilters: UserFilterCriteria = {
      orgId: filters.orgId,
      role: filters.role,
      isActive: filters.isActive,
      search: filters.search,
    };

    const [listResult, total] = await Promise.all([
      this.userRepository.list(listFilter),
      this.userRepository.count(dbFilters),
    ]);

    const safeItems: ManagedUserRecord[] = listResult.items.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));

    return {
      items: safeItems,
      total,
    };
  }

  public async getById(
    input: GetManagedUserInput,
  ): Promise<ManagedUserRecord | null> {
    const user = await this.userRepository.findById(input.userId);

    if (user === null || user.orgId !== input.orgId) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  public async deactivateUserById(
    input: DeactivateUserByIdInput
  ): Promise<DeactivatedUser | null> {


    const user = await this.userRepository.deactivate(input.userId);

    if (user === null || user.orgId !== input.orgId) {
      return null;
    }

    return {
      id: user.id,
      isActive: user.isActive,
      updatedAt: user.updatedAt,
    };
  }
}




