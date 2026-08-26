import type { ManagedUserRole } from "./user-management.contracts.js";

export interface UserMutationInput {
  readonly userId: string;
  readonly orgId: string;
}

export interface UpdateManagedUserInput extends UserMutationInput {
  readonly role?: ManagedUserRole;
  readonly displayName?: string | null;
}

export interface ResetManagedUserPasswordInput extends UserMutationInput {
  readonly passwordHash: string;
}

export interface MutatedManagedUser {
  readonly id: string;
  readonly username: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly updatedAt: Date;
}

export interface IUserMutationRepository {
  updateUser(input: UpdateManagedUserInput): Promise<MutatedManagedUser | null>;
  resetPassword(input: ResetManagedUserPasswordInput): Promise<MutatedManagedUser | null>;
}

export type UserMutationAuditAction = "user_update" | "user_password_reset";

export interface UserMutationAuditInput {
  readonly action: UserMutationAuditAction;
  readonly actorId: string;
  readonly actorUsername: string;
  readonly actorRole: ManagedUserRole;
  readonly ipAddress: string | null;
  readonly orgId: string;
  readonly user: MutatedManagedUser;
  readonly changedFields: readonly string[];
}

export interface IUserMutationAuditWriter {
  record(input: UserMutationAuditInput): Promise<void>;
}

export interface UserMutationTransactionContext {
  readonly users: IUserMutationRepository;
  readonly audit: IUserMutationAuditWriter;
}

export interface IUserMutationUnitOfWork {
  execute<TResult>(operation: (context: UserMutationTransactionContext) => Promise<TResult>): Promise<TResult>;
}
