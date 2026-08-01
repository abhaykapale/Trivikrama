import type { AuthRole } from "../../domain/auth.types.js";

/** Preserve backward compatibility for existing consumers. */
type UserRole = AuthRole;

export type IsoDateTimeString = string;

export interface AuthUserDto {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: UserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: IsoDateTimeString | null;
  readonly createdAt: IsoDateTimeString;
}

export type LoginResponseUserDto = Pick<
  AuthUserDto,
  "id" | "username" | "email" | "role" | "displayName" | "lastLoginAt"
>;

export interface SessionContextDto {
  readonly userId: string;
  readonly username: string;
  readonly role: UserRole;
  readonly jwtId: string;
  readonly issuedAt: IsoDateTimeString;
  readonly expiresAt: IsoDateTimeString;
  readonly issuer: string;
  readonly orgId?: string;
}

export interface LoginRequestDto {
  readonly username: string;
  readonly password: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface LoginResponseDto {
  readonly token: string;
  readonly user: LoginResponseUserDto;
  readonly expiresAt: IsoDateTimeString;
}

export interface LogoutRequestDto {
  readonly session: SessionContextDto;
}

export interface LogoutResponseDto {
  readonly message: "Logged out successfully";
}

export interface RefreshTokenRequestDto {
  readonly token: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface RefreshTokenResponseDto {
  readonly token: string;
  readonly expiresAt: IsoDateTimeString;
}

export interface GetCurrentUserRequestDto {
  readonly session: SessionContextDto;
}
