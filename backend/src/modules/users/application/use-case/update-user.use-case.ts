import AppError from "../../../../shared/errors/AppError.js";
import ErrorCodes from "../../../../shared/errors/ErrorCodes.js";
import type { ManagedUserRole } from "../../domain/user-management.contracts.js";
import type { IUserMutationUnitOfWork } from "../../domain/user-mutation.contracts.js";

export interface UpdateUserCommand {
  readonly userId: string; readonly orgId: string; readonly role?: ManagedUserRole; readonly displayName?: string | null;
  readonly actorId: string; readonly actorUsername: string; readonly actorRole: ManagedUserRole; readonly ipAddress: string | null;
}
export interface UpdateUserResult { readonly id: string; readonly role: ManagedUserRole; readonly displayName: string | null; readonly updatedAt: string; }

export class UpdateUserUseCase {
  public constructor(private readonly unitOfWork: IUserMutationUnitOfWork) {}
  public async execute(input: UpdateUserCommand): Promise<UpdateUserResult> {
    const user = await this.unitOfWork.execute(async ({ users, audit }) => {
      const updated = await users.updateUser({ userId: input.userId, orgId: input.orgId, role: input.role, displayName: input.displayName });
      if (updated === null) throw new AppError("User not found.", 404, ErrorCodes.NOT_FOUND);
      const changedFields = [input.role === undefined ? null : "role", input.displayName === undefined ? null : "displayName"].filter((field): field is string => field !== null);
      await audit.record({ action: "user_update", actorId: input.actorId, actorUsername: input.actorUsername, actorRole: input.actorRole, ipAddress: input.ipAddress, orgId: input.orgId, user: updated, changedFields });
      return updated;
    });
    return { id: user.id, role: user.role, displayName: user.displayName, updatedAt: user.updatedAt.toISOString() };
  }
}
