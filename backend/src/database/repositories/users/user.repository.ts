import type {
  PageResult,
  PaginationOptions,
  TransactionClient,
} from "../common/repository.types.js";

export type UserRole = "admin" | "security_engineer" | "soc_analyst";

export interface UserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

export interface UserListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
  readonly search?: string;
}

export interface CreateUserInput {
  readonly id?: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly displayName?: string | null;
  readonly isActive?: boolean;
  readonly orgId?: string;
}

export interface UpdateUserInput {
  readonly email?: string;
  readonly passwordHash?: string;
  readonly role?: UserRole;
  readonly displayName?: string | null;
  readonly isActive?: boolean;
  readonly failedLoginCount?: number;
  readonly lockedUntil?: Date | null;
  readonly lastLoginAt?: Date | string | null;
}

export interface IUserRepository {
  withTransaction(transaction: TransactionClient): IUserRepository;
  findById(id: string): Promise<UserRecord | null>;
  findByUsername(username: string, orgId?: string): Promise<UserRecord | null>;
  findByUsernameAndOrg(
    username: string,
    orgId: string,
  ): Promise<UserRecord | null>;
  findByEmail(email: string, orgId?: string): Promise<UserRecord | null>;
  list(filters?: UserListFilters): Promise<PageResult<UserRecord>>;
  create(input: CreateUserInput): Promise<UserRecord>;
  update(id: string, input: UpdateUserInput): Promise<UserRecord | null>;

  /** Atomically increments failed_login_count and returns the updated row. */
  incrementFailedLoginCount(id: string): Promise<UserRecord | null>;
  resetLoginFailures(id: string): Promise<UserRecord | null>;
  markLastLogin(id: string, loginAt?: Date): Promise<UserRecord | null>;
  lockUserUntil(id: string, lockedUntil: Date): Promise<UserRecord | null>;

  /** Existing convenience operation retained for compatibility. */
  recordSuccessfulLogin(id: string, loginAt?: Date): Promise<UserRecord | null>;

  /**
   * @deprecated Use incrementFailedLoginCount and lockUserUntil. The supplied
   * count is ignored so this method cannot reintroduce a read-modify-write race.
   */
  recordFailedLogin(
    id: string,
    failedLoginCount: number,
    lockedUntil?: Date | null,
  ): Promise<UserRecord | null>;

  deactivate(id: string): Promise<UserRecord | null>;
}
