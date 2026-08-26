import type { IUserRepository } from "../../../database/index.js";
import {
  UserUniquenessConflictError,
  type CreatedManagedUser,
  type CreateManagedUserRepositoryInput,
  type IUserCreationRepository,
} from "../domain/user-creation.contracts.js";

type UserCreationPersistence = Pick<
  IUserRepository,
  "findByUsername" | "findByEmail" | "create"
>;

export class UserCreationRepositoryAdapter
  implements IUserCreationRepository
{
  public constructor(
    private readonly userRepository: UserCreationPersistence,
  ) {}

  public async usernameExists(
    username: string,
    orgId: string,
  ): Promise<boolean> {
    return (await this.userRepository.findByUsername(username, orgId)) !== null;
  }

  public async emailExists(email: string, orgId: string): Promise<boolean> {
    return (await this.userRepository.findByEmail(email, orgId)) !== null;
  }

  public async createUser(
    input: CreateManagedUserRepositoryInput,
  ): Promise<CreatedManagedUser> {
    try {
      const user = await this.userRepository.create({
        username: input.username,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        displayName: input.displayName,
        isActive: true,
        orgId: input.orgId,
      });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        isActive: user.isActive,
        createdAt: user.createdAt,
      };
    } catch (error: unknown) {
      const field = getUniqueConflictField(error);

      if (field !== null) {
        throw new UserUniquenessConflictError(field);
      }

      throw error;
    }
  }
}

function getUniqueConflictField(
  error: unknown,
): "username" | "email" | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const postgresError = error as {
    readonly code?: unknown;
    readonly constraint?: unknown;
  };

  if (postgresError.code !== "23505") {
    return null;
  }

  if (postgresError.constraint === "uq_users_username_org") {
    return "username";
  }

  if (postgresError.constraint === "uq_users_email_org") {
    return "email";
  }

  return null;
}
