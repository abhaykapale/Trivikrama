import AppError from "../../../../shared/errors/AppError";
import ErrorCodes from "../../../../shared/errors/ErrorCodes";
import type { IUserManagementRepository } from "../../domain/user-management.contracts.js";
import type { ManagedUserDTO } from "../dto/user.dto.js";

export interface GetUserByIdInput {
  readonly userId: string;
  readonly orgId: string;
}

export class GetUserByIdUseCase {
  public constructor(private readonly repository: IUserManagementRepository) {}

  public async execute(input: GetUserByIdInput): Promise<ManagedUserDTO> {
    const user = await this.repository.getById({userId: input.userId, orgId: input.orgId});

    if (user === null) {
      throw new AppError("User not found.", 404, ErrorCodes.NOT_FOUND);
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt:
        user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }
}
