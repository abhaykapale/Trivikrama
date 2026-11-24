export const USER_ROLES = ["admin", "security_engineer", "soc_analyst"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: UserRole;
  readonly displayName: string | null;
  readonly lastLoginAt: string | null;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface SafeSession {
  readonly user: SessionUser;
  readonly expiresAt: string | null;
}

export interface ManagedUserSummary {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: UserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
}

export interface ManagedUserPage {
  readonly data: readonly ManagedUserSummary[];
  readonly pagination: { readonly page: number; readonly limit: number; readonly total: number; readonly totalPages: number; readonly hasNext: boolean; readonly hasPrev: boolean };
}
