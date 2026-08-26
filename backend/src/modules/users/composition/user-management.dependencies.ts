import type {
  IAuditRepository,
  IUserRepository,
  IUnitOfWork,
} from "../../../database/index.js";
import type { PasswordHasher } from "../domain/user-creation.contracts.js";
import type {
  IUserCreationAuditWriter,
  IUserCreationUnitOfWork,
  UserCreationTransactionContext,
  UserCreatedAuditInput,
} from "../domain/user-creation.contracts.js";
import { CreateUserUseCase } from "../application/use-case/create-user.use-case.js";
import { DeactivateUserByIdUseCase } from "../application/use-case/list-detactivate-user.use-case";
import { GetUserByIdUseCase } from "../application/use-case/list-getuser.use-case";
import { ListUsersUseCase } from "../application/use-case/list-users.use-case";
import { UserCreationRepositoryAdapter } from "../infrastructure/user-creation.repository.adapter.js";
import { UserManagementRepositoryAdapter } from "../infrastructure/user-management.repository.adapter";
import { UserMutationRepositoryAdapter } from "../infrastructure/user-mutation.repository.adapter.js";
import { UpdateUserUseCase } from "../application/use-case/update-user.use-case.js";
import { ResetUserPasswordUseCase } from "../application/use-case/reset-user-password.use-case.js";
import type { IUserMutationAuditWriter, IUserMutationUnitOfWork, UserMutationAuditInput, UserMutationTransactionContext } from "../domain/user-mutation.contracts.js";

export interface CreateUserManagementDependencies {
  readonly userRepository: Pick<
    IUserRepository,
    "list" | "count" | "findById" | "deactivate"
  >;
  readonly userCreationRepository: Pick<
    IUserRepository,
    "findByUsername" | "findByEmail" | "create"
  >;
  readonly passwordHasher: PasswordHasher;
  readonly unitOfWork: IUnitOfWork;
}

export interface UserManagementDependencies {
  readonly listUsersUseCase: ListUsersUseCase;
  readonly getUserByIdUseCase: GetUserByIdUseCase;
  readonly deactivateUserByIdUseCase: DeactivateUserByIdUseCase;
  readonly createUserUseCase: CreateUserUseCase;
  readonly updateUserUseCase: UpdateUserUseCase;
  readonly resetUserPasswordUseCase: ResetUserPasswordUseCase;
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

  const deactivateUserByIdUseCase = new DeactivateUserByIdUseCase(
    userManagementRepositoryAdapter,
  );

  const userCreationLookupRepository = new UserCreationRepositoryAdapter(
    input.userCreationRepository,
  );

  const userCreationUnitOfWork = new PostgresUserCreationUnitOfWorkAdapter(
    input.unitOfWork,
  );

  const createUserUseCase = new CreateUserUseCase(
    userCreationLookupRepository,
    input.passwordHasher,
    userCreationUnitOfWork,
  );

  const userMutationUnitOfWork = new PostgresUserMutationUnitOfWorkAdapter(input.unitOfWork);
  const updateUserUseCase = new UpdateUserUseCase(userMutationUnitOfWork);
  const resetUserPasswordUseCase = new ResetUserPasswordUseCase(input.passwordHasher, userMutationUnitOfWork);

  return {
    listUsersUseCase,
    getUserByIdUseCase,
    deactivateUserByIdUseCase,
    createUserUseCase,
    updateUserUseCase,
    resetUserPasswordUseCase,
  };
}

class PostgresUserMutationUnitOfWorkAdapter implements IUserMutationUnitOfWork {
  public constructor(private readonly unitOfWork: IUnitOfWork) {}
  public async execute<TResult>(operation: (context: UserMutationTransactionContext) => Promise<TResult>): Promise<TResult> {
    return this.unitOfWork.execute(
      async ({ repositories }) => operation({
        users: new UserMutationRepositoryAdapter(repositories.users),
        audit: new UserMutationAuditWriterAdapter(repositories.audit),
      }),
      { isolationLevel: "read committed", statementTimeoutMs: 5_000, lockTimeoutMs: 2_000 },
    );
  }
}

class UserMutationAuditWriterAdapter implements IUserMutationAuditWriter {
  public constructor(private readonly auditRepository: Pick<IAuditRepository, "create">) {}
  public async record(input: UserMutationAuditInput): Promise<void> {
    await this.auditRepository.create({
      action: input.action,
      actorId: input.actorId,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      ipAddress: input.ipAddress,
      targetType: "user",
      targetId: input.user.id,
      targetName: input.user.username,
      details: { changedFields: input.changedFields },
      newState: input.action === "user_update" ? { role: input.user.role, displayName: input.user.displayName } : null,
      orgId: input.orgId,
    });
  }
}

class PostgresUserCreationUnitOfWorkAdapter
  implements IUserCreationUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public async execute<TResult>(
    operation: (
      context: UserCreationTransactionContext,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      async ({ repositories }) =>
        operation({
          users: new UserCreationRepositoryAdapter(repositories.users),
          audit: new UserCreationAuditWriterAdapter(repositories.audit),
        }),
      {
        isolationLevel: "read committed",
        statementTimeoutMs: 5_000,
        lockTimeoutMs: 2_000,
      },
    );
  }
}

class UserCreationAuditWriterAdapter implements IUserCreationAuditWriter {
  public constructor(
    private readonly auditRepository: Pick<IAuditRepository, "create">,
  ) {}

  public async recordUserCreated(input: UserCreatedAuditInput): Promise<void> {
    await this.auditRepository.create({
      action: "user_create",
      actorId: input.actorId,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      ipAddress: input.ipAddress,
      targetType: "user",
      targetId: input.user.id,
      targetName: input.user.username,
      details: {
        role: input.user.role,
      },
      newState: {
        username: input.user.username,
        email: input.user.email,
        role: input.user.role,
        displayName: input.user.displayName,
        isActive: input.user.isActive,
      },
      orgId: input.orgId,
    });
  }
}
