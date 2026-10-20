import type { IncidentNotificationDispatcher } from "../application/incident-notification-dispatcher.js";

export interface IncidentNotificationDispatcherLogger {
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

export interface IncidentNotificationDispatcherRunnerOptions {
  readonly pollIntervalMs?: number;
  readonly logger?: IncidentNotificationDispatcherLogger;
}

export class IncidentNotificationDispatcherRunner {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private closing = false;
  private readonly pollIntervalMs: number;

  public constructor(
    private readonly dispatcher: IncidentNotificationDispatcher,
    private readonly options: IncidentNotificationDispatcherRunnerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) {
      throw new Error("Incident notification poll interval must be at least 100ms.");
    }
  }

  public start(): void {
    if (this.timer !== null || this.active !== null) return;
    this.closing = false;
    this.schedule(0);
  }

  public async close(): Promise<void> {
    this.closing = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.active;
  }

  private schedule(delayMs: number): void {
    if (this.closing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.active = this.runOnce().finally(() => {
        this.active = null;
        this.schedule(this.pollIntervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }

  private async runOnce(): Promise<void> {
    try {
      const result = await this.dispatcher.dispatchBatch();
      if (result.claimed > 0) {
        this.options.logger?.info("Incident notification outbox batch dispatched.", {
          ...result,
        });
      }
    } catch (error) {
      this.options.logger?.error("Incident notification outbox dispatch failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
