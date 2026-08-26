import AppError from "../../../../shared/errors/AppError";
import ErrorCodes from "../../../../shared/errors/ErrorCodes";
import type { DeactivatedUser, DeactivateUserByIdInput, IUserManagementRepository } from "../../domain/user-management.contracts.js";




export class DeactivateUserByIdUseCase {
  public constructor(private readonly repository: IUserManagementRepository) {}

  public async execute(
    input: DeactivateUserByIdInput,
  ): Promise<DeactivatedUser> {
    const user = await this.repository.deactivateUserById({
      userId: input.userId,
      orgId: input.orgId,
    });

    if (user === null) {
      throw new AppError("User not found.", 404, ErrorCodes.NOT_FOUND);
    }

    return {
      id: user.id,
      isActive: user.isActive,
      updatedAt: user.updatedAt,
    };
  }
}
