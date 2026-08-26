import AppError from "../../../../shared/errors/AppError.js";
import ErrorCodes from "../../../../shared/errors/ErrorCodes.js";
import type { ManagedUserRole } from "../../domain/user-management.contracts.js";
import {
  UserUniquenessConflictError,
  type IUserCreationRepository,
  type IUserCreationUnitOfWork,
  type PasswordHasher,
} from "../../domain/user-creation.contracts.js";

export interface CreateUserCommand {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly role: ManagedUserRole;
  readonly displayName?: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly actorUsername: string;
  readonly actorRole: ManagedUserRole;
  readonly ipAddress: string | null;
}

export interface CreateUserResult {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export class CreateUserUseCase {
  public constructor(
    private readonly lookupRepository: IUserCreationRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly unitOfWork: IUserCreationUnitOfWork,
  ) {}

  public async execute(input: CreateUserCommand): Promise<CreateUserResult> {
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim() ?? null;

    const [usernameExists, emailExists] = await Promise.all([
      this.lookupRepository.usernameExists(username, input.orgId),
      this.lookupRepository.emailExists(email, input.orgId),
    ]);

    if (usernameExists) {
      throw usernameConflict(username);
    }

    if (emailExists) {
      throw emailConflict(email);
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      const user = await this.unitOfWork.execute(async ({ users, audit }) => {
        const createdUser = await users.createUser({
          username,
          email,
          passwordHash,
          role: input.role,
          displayName,
          orgId: input.orgId,
        });

        await audit.recordUserCreated({
          actorId: input.actorId,
          actorUsername: input.actorUsername,
          actorRole: input.actorRole,
          ipAddress: input.ipAddress,
          user: createdUser,
          orgId: input.orgId,
        });

        return createdUser;
      });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof UserUniquenessConflictError) {
        if (error.field === "username") {
          throw usernameConflict(username);
        }

        throw emailConflict(email);
      }

      throw error;
    }
  }
}

function usernameConflict(username: string): AppError {
  return new AppError(
    `Username ${username} already exists`,
    409,
    ErrorCodes.USERNAME_EXISTS,
  );
}

function emailConflict(email: string): AppError {
  return new AppError(
    `Email ${email} already exists`,
    409,
    ErrorCodes.EMAIL_EXISTS,
  );
}
