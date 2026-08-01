import * as bcrypt from "bcrypt";

import type { IPasswordService } from "../../domain/auth.contracts.js";

const DEFAULT_BCRYPT_ROUNDS = 12;

export class BcryptPasswordService implements IPasswordService {
  public readonly rounds: number;

  public constructor(rounds = DEFAULT_BCRYPT_ROUNDS) {
    if (!Number.isInteger(rounds) || rounds !== DEFAULT_BCRYPT_ROUNDS) {
      throw new Error("BcryptPasswordService requires exactly 12 bcrypt rounds.");
    }

    this.rounds = rounds;
  }

  public async hash(plainPassword: string): Promise<string> {
    if (typeof plainPassword !== "string" || plainPassword.length === 0) {
      throw new Error("Password must be a non-empty string.");
    }

    return bcrypt.hash(plainPassword, this.rounds);
  }

  public async verify(
    plainPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    if (
      typeof plainPassword !== "string" ||
      typeof passwordHash !== "string" ||
      passwordHash.length === 0
    ) {
      return false;
    }

    try {
      return await bcrypt.compare(plainPassword, passwordHash);
    } catch {
      return false;
    }
  }

  /** @deprecated Use hash() instead. */
  public async hashPassword(plainPassword: string): Promise<string> {
    return this.hash(plainPassword);
  }

  /** @deprecated Use verify() instead. */
  public async verifyPassword(
    plainPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.verify(plainPassword, passwordHash);
  }
}
