
import type { IUserRepository } from "../../../database";
import type { UserListFilters,UserFilterCriteria, } from "../../../database";
import type { GetManagedUserInput, IUserManagementRepository, ManagedUserFilters, ManagedUserRecord, PageResult } from "../domain/user-management.contracts";


type UserManagementPersistence = Pick<IUserRepository, "list" | "count"  |"findById" >;



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
}



/*

for each implementation  please explain why we are doing this and it connects it with other and how it communicates and how the flow will be and also im making physical notes so that i can use these ideas for my future project so give me that also and how to make those notes also so that from next time i can think it on my own

class UserManagementRepositoryAdapter implements domain repository

    constructor(database user repository)

    list(domain filters)
        create shared count criteria
        create list filters with limit and offset

        concurrently request:
            paginated database users
            exact total count

        map each database user:
            copy only safe fields

        return:
            safe items
            total
*/
