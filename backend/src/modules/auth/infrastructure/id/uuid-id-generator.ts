import { randomUUID } from "node:crypto";

import type { IIdGenerator } from "../../domain/auth.contracts.js";

export class UuidIdGenerator implements IIdGenerator {
  public generate(): string {
    return randomUUID();
  }

  /** @deprecated Use generate() instead. */
  public generateUuid(): string {
    return this.generate();
  }

  /** @deprecated Use generate() instead. */
  public generateJwtId(): string {
    return this.generate();
  }
}
