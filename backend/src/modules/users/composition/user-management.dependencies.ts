import type { IUserRepository } from "../../../database";
import { ListUsersUseCase } from "../application/use-case/list-users.use-case";
import { UserManagementRepositoryAdapter } from "../infrastructure/user-management.repository.adapter";

export interface CreateUserManagementDependencies {
 readonly userRepository: Pick<IUserRepository, "list" | "count">;
}

export interface UserManagementDependencies {
  readonly listUsersUseCase: ListUsersUseCase;
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

  return {
    listUsersUseCase,
  };
}
