import AppError from "../../../../shared/errors/AppError.js";
import ErrorCodes from "../../../../shared/errors/ErrorCodes.js";
import type { PasswordHasher } from "../../domain/user-creation.contracts.js";
import type { ManagedUserRole } from "../../domain/user-management.contracts.js";
import type { IUserMutationUnitOfWork } from "../../domain/user-mutation.contracts.js";

export interface ResetUserPasswordCommand { readonly userId: string; readonly orgId: string; readonly newPassword: string; readonly actorId: string; readonly actorUsername: string; readonly actorRole: ManagedUserRole; readonly ipAddress: string | null; }
export interface ResetUserPasswordResult { readonly message: string; readonly userId: string; }
export class ResetUserPasswordUseCase {
  public constructor(private readonly passwordHasher: PasswordHasher, private readonly unitOfWork: IUserMutationUnitOfWork) {}
  public async execute(input: ResetUserPasswordCommand): Promise<ResetUserPasswordResult> {
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const user = await this.unitOfWork.execute(async ({ users, audit }) => {
      const updated = await users.resetPassword({ userId: input.userId, orgId: input.orgId, passwordHash });
      if (updated === null) throw new AppError("User not found.", 404, ErrorCodes.NOT_FOUND);
      await audit.record({ action: "user_password_reset", actorId: input.actorId, actorUsername: input.actorUsername, actorRole: input.actorRole, ipAddress: input.ipAddress, orgId: input.orgId, user: updated, changedFields: ["password"] });
      return updated;
    });
    return { message: "Password reset successfully", userId: user.id };
  }
}
