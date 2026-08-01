import type { IClock } from "../../domain/auth.contracts.js";

export class SystemClock implements IClock {
  public now(): Date {
    return new Date();
  }

  public nowUnixSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}
