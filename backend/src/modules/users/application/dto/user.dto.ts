import { ManagedUserRole } from "../../domain/user-management.contracts";

export interface ManagedUserDTO {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: ManagedUserRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface ListUsersRequestDTO {
  readonly orgId: string;
  readonly limit: number;
  readonly page: number;
  readonly role?: ManagedUserRole;
  readonly isActive?: boolean;
  readonly search?: string;
}

export interface PaginationDTO {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
}


export interface ListUsersResponseDTO
{
    readonly data: ManagedUserDTO[];
    readonly pagination: PaginationDTO;
}







