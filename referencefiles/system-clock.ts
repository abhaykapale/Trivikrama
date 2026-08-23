export class SystemClock {
  public now(): Date {
    return new Date();
  }

  public nowUnixSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}
