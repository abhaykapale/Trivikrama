import type { IUserRepository, UserRecord } from "../../../database/index.js";
import type {
  IUserMutationRepository,
  MutatedManagedUser,
  ResetManagedUserPasswordInput,
  UpdateManagedUserInput,
} from "../domain/user-mutation.contracts.js";

type UserMutationPersistence = Pick<IUserRepository, "updateByIdAndOrg">;

export class UserMutationRepositoryAdapter implements IUserMutationRepository {
  public constructor(private readonly userRepository: UserMutationPersistence) {}

  public async updateUser(input: UpdateManagedUserInput): Promise<MutatedManagedUser | null> {
    const user = await this.userRepository.updateByIdAndOrg(input.userId, input.orgId, {
      role: input.role,
      displayName: input.displayName,
    });
    return user === null ? null : mapUser(user);
  }

  public async resetPassword(input: ResetManagedUserPasswordInput): Promise<MutatedManagedUser | null> {
    const user = await this.userRepository.updateByIdAndOrg(input.userId, input.orgId, {
      passwordHash: input.passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    return user === null ? null : mapUser(user);
  }
}

function mapUser(user: UserRecord): MutatedManagedUser {
  return { id: user.id, username: user.username, role: user.role, displayName: user.displayName, updatedAt: user.updatedAt };
}
