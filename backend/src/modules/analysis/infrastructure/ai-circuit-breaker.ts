import type { AiCircuitState } from "../domain/ai-client.contracts.js";

export interface AiCircuitBreakerConfiguration {
    readonly failureThreshold: number;
    readonly cooldownMs: number;
    readonly successThreshold: number;
}

/** Small deterministic circuit breaker with a single half-open probe lease. */
export class AiCircuitBreaker {
    private state: AiCircuitState = "closed";
    private consecutiveFailures = 0;
    private halfOpenSuccesses = 0;
    private openedAt: number | null = null;
    private halfOpenProbeActive = false;

    public constructor(
        private readonly configuration: AiCircuitBreakerConfiguration,
        private readonly now: () => number = Date.now,
    ) {
        requirePositiveInteger(configuration.failureThreshold, "failureThreshold");
        requirePositiveInteger(configuration.cooldownMs, "cooldownMs");
        requirePositiveInteger(configuration.successThreshold, "successThreshold");
    }

    public tryAcquire(): boolean {
        this.refreshState();

        if (this.state === "open") return false;
        if (this.state === "closed") return true;
        if (this.halfOpenProbeActive) return false;

        this.halfOpenProbeActive = true;
        return true;
    }

    public reportSuccess(): void {
        if (this.state === "half-open") {
            this.halfOpenProbeActive = false;
            this.halfOpenSuccesses += 1;

            if (this.halfOpenSuccesses >= this.configuration.successThreshold) {
                this.close();
            }
            return;
        }

        this.consecutiveFailures = 0;
    }

    public reportFailure(): void {
        this.halfOpenProbeActive = false;

        if (this.state === "half-open") {
            this.open();
            return;
        }

        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.configuration.failureThreshold) this.open();
    }

    public getState(): AiCircuitState {
        this.refreshState();
        return this.state;
    }

    private refreshState(): void {
        if (
            this.state === "open" &&
            this.openedAt !== null &&
            this.now() - this.openedAt >= this.configuration.cooldownMs
        ) {
            this.state = "half-open";
            this.halfOpenSuccesses = 0;
            this.halfOpenProbeActive = false;
        }
    }

    private open(): void {
        this.state = "open";
        this.openedAt = this.now();
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
    }

    private close(): void {
        this.state = "closed";
        this.openedAt = null;
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
        this.halfOpenProbeActive = false;
    }
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`AI circuit breaker ${name} must be a positive integer.`);
    }
}
