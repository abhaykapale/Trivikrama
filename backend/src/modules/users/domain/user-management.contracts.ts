

export type ManagedUserRole = "admin" | "security_engineer" | "soc_analyst";

export interface ManagedUserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

export interface GetManagedUserInput {
  readonly userId: string;
  readonly orgId: string;
}


export interface ManagedUserFilters {
  readonly orgId: string;
  readonly limit: number;
  readonly offset: number;
  readonly role?: ManagedUserRole;
  readonly isActive?: boolean;
  readonly search?: string;
}

export interface PageResult<ManagedUserPage> {
  readonly items: readonly ManagedUserPage[];
  readonly total: number;
}

export interface IUserManagementRepository {
  list(filters: ManagedUserFilters): Promise<PageResult<ManagedUserRecord>>;
  getById(input: GetManagedUserInput): Promise<ManagedUserRecord | null>;
}

