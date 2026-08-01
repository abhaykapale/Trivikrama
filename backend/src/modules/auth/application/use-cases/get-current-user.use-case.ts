import type { IUserRepository } from "../../domain/auth.contracts.js";
import type { AuthUserDto } from "../dto/index.js";
import { UserInactiveError, UserNotFoundError } from "../errors/index.js";

export interface GetCurrentUserUseCaseInput {
  readonly userId: string;
}

type UserRepositoryWithFindById = Pick<IUserRepository, "findById">;

export class GetCurrentUserUseCase {
  public constructor(
    private readonly userRepository: UserRepositoryWithFindById,
  ) {}

  public async execute(input: GetCurrentUserUseCaseInput): Promise<AuthUserDto> {
    const userId = normalizeUserId(input.userId);
    const user = await this.userRepository.findById(userId);

    if (user === null) {
      throw new UserNotFoundError();
    }

    if (!user.isActive) {
      throw new UserInactiveError();
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      isActive: user.isActive,
      lastLoginAt: toNullableIsoDateTimeString(user.lastLoginAt),
      createdAt: toIsoDateTimeString(user.createdAt),
    };
  }
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();

  if (normalized.length === 0) {
    throw new UserNotFoundError();
  }

  return normalized;
}

function toNullableIsoDateTimeString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return toIsoDateTimeString(value);
}

function toIsoDateTimeString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("User date field is invalid.");
  }

  return date.toISOString();
}