import type { ManagedUserRole } from "./user-management.contracts.js";

export type UserUniquenessField = "username" | "email";

export class UserUniquenessConflictError extends Error {
  public constructor(public readonly field: UserUniquenessField) {
    super(`A user with this ${field} already exists.`);
    this.name = "UserUniquenessConflictError";
  }
}

export interface CreateManagedUserRepositoryInput {
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly orgId: string;
}

export interface CreatedManagedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface IUserCreationRepository {
  usernameExists(username: string, orgId: string): Promise<boolean>;
  emailExists(email: string, orgId: string): Promise<boolean>;
  createUser(
    input: CreateManagedUserRepositoryInput,
  ): Promise<CreatedManagedUser>;
}

export interface UserCreatedAuditInput {
  readonly actorId: string;
  readonly actorUsername: string;
  readonly actorRole: ManagedUserRole;
  readonly ipAddress: string | null;
  readonly user: CreatedManagedUser;
  readonly orgId: string;
}

export interface IUserCreationAuditWriter {
  recordUserCreated(input: UserCreatedAuditInput): Promise<void>;
}

export interface UserCreationTransactionContext {
  readonly users: IUserCreationRepository;
  readonly audit: IUserCreationAuditWriter;
}

export interface IUserCreationUnitOfWork {
  execute<TResult>(
    operation: (
      context: UserCreationTransactionContext,
    ) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface PasswordHasher {
  hash(plainTextPassword: string): Promise<string>;
}
