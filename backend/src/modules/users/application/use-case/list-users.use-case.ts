import type { IUserManagementRepository } from "../../domain/user-management.contracts.js";
import type  {
  ListUsersRequestDTO,
  ListUsersResponseDTO,
  ManagedUserDTO,
  PaginationDTO,
} from "../dto/user.dto.js";


export class ListUsersUseCase {
  constructor(private readonly repository: IUserManagementRepository) {}

  public async execute( input: ListUsersRequestDTO ): Promise<ListUsersResponseDTO> {
    const offset = (input.page - 1) * input.limit;

    const filters = {
      orgId: input.orgId,
      limit: input.limit,
      offset: offset,
      role: input.role,
      isActive: input.isActive,
      search: input.search?.trim() || undefined,
    };
    const result = await this.repository.list(filters);

    const data: ManagedUserDTO[] = result.items.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    }));

    const totalPages = Math.ceil(result.total / input.limit);
    const hasNext = input.page < totalPages;
    const hasPrev = input.page > 1;

    const pagination: PaginationDTO = {
      page: input.page,
      limit: input.limit,
      total: result.total,
      hasNext: hasNext,
      hasPrev: hasPrev,
      totalPages: totalPages,
    };
      return {
          data,
          pagination,
      };
  }
}



/*
PseudoCode for ListUsersUseCase:
class ListUsersUseCase

    constructor(repository)
        save repository

    execute(request)
        calculate offset

        build filters using:
            organization
            limit
            offset
            optional role
            optional active status
            optional trimmed search

        await repository.list(filters)

        map every domain user:
            copy public properties
            convert createdAt to ISO string
            convert lastLoginAt when not null

        calculate:
            totalPages
            hasNext
            hasPrev

        return:
            data
            pagination
*/
