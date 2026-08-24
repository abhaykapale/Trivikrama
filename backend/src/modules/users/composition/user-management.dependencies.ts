import type { IUserRepository } from "../../../database";
import { GetUserByIdUseCase } from "../application/use-case/list-getuser.use-case";
import { ListUsersUseCase } from "../application/use-case/list-users.use-case";
import { UserManagementRepositoryAdapter } from "../infrastructure/user-management.repository.adapter";

export interface CreateUserManagementDependencies {
 readonly userRepository: Pick<IUserRepository, "list" | "count" | "findById">;
}

export interface UserManagementDependencies {
  readonly listUsersUseCase: ListUsersUseCase;
  readonly getUserByIdUseCase: GetUserByIdUseCase;
}

export function createUserManagementDependencies(
  input: CreateUserManagementDependencies,
): UserManagementDependencies {

    const userManagementRepositoryAdapter = new UserManagementRepositoryAdapter(
    input.userRepository,
  );

  const listUsersUseCase = new ListUsersUseCase(
    userManagementRepositoryAdapter,
  );

  const getUserByIdUseCase = new GetUserByIdUseCase(
    userManagementRepositoryAdapter,
  );

  return {
    listUsersUseCase,
    getUserByIdUseCase,
  };
}
