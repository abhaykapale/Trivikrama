import type { RedisClient } from "../../../database/redis/client.js";
import { RULE_RELOAD_CHANNEL } from "./redis-rule-reload.publisher.js";

export interface RuleReloadTarget {
  reloadRules(): Promise<void>;
}

export interface RuleReloadSubscriberLogger {
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

export class RedisRuleReloadSubscriber {
  private readonly subscriber: RedisClient;
  private started = false;
  private readonly onMessage = (channel: string, payload: string): void => {
    if (channel !== RULE_RELOAD_CHANNEL) return;
    const signal = parseSignal(payload);
    if (signal?.organizationId !== this.organizationId) return;

    void this.target.reloadRules().then(
      () => this.logger?.info("Detection rules hot-reloaded", {
        organizationId: this.organizationId,
        ruleId: signal.ruleId,
        revision: signal.revision,
      }),
      (error: unknown) => this.logger?.error("Detection rule hot-reload failed", {
        organizationId: this.organizationId,
        ruleId: signal.ruleId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  public constructor(
    redis: RedisClient,
    private readonly organizationId: string,
    private readonly target: RuleReloadTarget,
    private readonly logger?: RuleReloadSubscriberLogger,
  ) {
    if (organizationId.trim().length === 0) {
      throw new Error("Rule reload subscriber organizationId must not be blank.");
    }
    this.subscriber = redis.duplicate();
    this.subscriber.on("error", () => undefined);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    if (this.subscriber.status === "wait") await this.subscriber.connect();
    this.subscriber.on("message", this.onMessage);
    await this.subscriber.subscribe(RULE_RELOAD_CHANNEL);
    this.started = true;
  }

  public async close(): Promise<void> {
    if (this.subscriber.status === "end") return;
    this.subscriber.off("message", this.onMessage);
    if (this.started && this.subscriber.status === "ready") {
      await this.subscriber.unsubscribe(RULE_RELOAD_CHANNEL).catch(() => undefined);
    }
    this.started = false;
    if (this.subscriber.status === "ready") {
      await this.subscriber.quit().catch(() => this.subscriber.disconnect());
    } else {
      this.subscriber.disconnect();
    }
  }
}

interface ParsedSignal {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly revision: number;
}

function parseSignal(payload: string): ParsedSignal | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 1 ||
      !("organizationId" in value) ||
      typeof value.organizationId !== "string" ||
      !("ruleId" in value) ||
      typeof value.ruleId !== "string" ||
      !("revision" in value) ||
      typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision)
    ) {
      return null;
    }
    return {
      organizationId: value.organizationId,
      ruleId: value.ruleId,
      revision: value.revision,
    };
  } catch {
    return null;
  }
}
