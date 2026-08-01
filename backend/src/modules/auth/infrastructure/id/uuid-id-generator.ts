import { randomUUID } from "node:crypto";

export class UuidIdGenerator {
  public generateUuid(): string {
    return randomUUID();
  }

  public generateJwtId(): string {
    return randomUUID();
  }
}
