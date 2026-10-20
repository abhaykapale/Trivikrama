import { selectAiFeatureVector, type FeatureEnrichedEvent } from "../../feature-extraction/index.js";
import type {
    AiClientStats,
    AiDetectionPrediction,
    AiDetectionResult,
    AiShapExplanation,
    IAIClient,
} from "../domain/ai-client.contracts.js";
import { AiCircuitBreaker } from "./ai-circuit-breaker.js";

export interface HttpAiClientConfiguration {
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly batchSize: number;
    readonly threshold: number;
    readonly includeShap?: boolean;
    readonly circuitFailureThreshold?: number;
    readonly circuitCooldownMs?: number;
    readonly circuitSuccessThreshold?: number;
}

export interface HttpAiClientDependencies {
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
    readonly circuitBreaker?: AiCircuitBreaker;
}

interface ParsedAiResponse {
    readonly predictions: readonly AiDetectionPrediction[];
    readonly modelVersion: string;
}

/** Contract-validating, timeout-bounded AI Engine adapter with graceful fallback. */
export class HttpAiClient implements IAIClient {
    private readonly detectionUrl: URL;
    private readonly timeoutMs: number;
    private readonly batchSize: number;
    private readonly threshold: number;
    private readonly includeShap: boolean;
    private readonly fetchImplementation: typeof fetch;
    private readonly now: () => number;
    private readonly circuitBreaker: AiCircuitBreaker;
    private totalRequests = 0;
    private successfulRequests = 0;
    private failedRequests = 0;
    private fallbacksUsed = 0;
    private totalLatencyMs = 0;

    public constructor(
        configuration: HttpAiClientConfiguration,
        dependencies: HttpAiClientDependencies = {},
    ) {
        this.detectionUrl = createDetectionUrl(configuration.baseUrl);
        this.timeoutMs = requirePositiveInteger(configuration.timeoutMs, "timeoutMs");
        this.batchSize = requireBatchSize(configuration.batchSize);
        this.threshold = requireProbability(configuration.threshold, "threshold");
        this.includeShap = configuration.includeShap ?? true;
        this.fetchImplementation = dependencies.fetch ?? fetch;
        this.now = dependencies.now ?? Date.now;
        this.circuitBreaker =
            dependencies.circuitBreaker ??
            new AiCircuitBreaker(
                {
                    failureThreshold: configuration.circuitFailureThreshold ?? 5,
                    cooldownMs: configuration.circuitCooldownMs ?? 60_000,
                    successThreshold: configuration.circuitSuccessThreshold ?? 2,
                },
                this.now,
            );
    }

    public async detect(events: readonly FeatureEnrichedEvent[]): Promise<AiDetectionResult> {
        assertUniqueEventIds(events);
        const startedAt = this.now();
        this.totalRequests += 1;

        if (events.length === 0) {
            this.successfulRequests += 1;
            return this.result(events.length, [], 0, startedAt, false);
        }

        const predictions: AiDetectionPrediction[] = [];
        let batchesSubmitted = 0;
        let usedFallback = false;

        for (let offset = 0; offset < events.length; offset += this.batchSize) {
            const batch = events.slice(offset, offset + this.batchSize);

            if (!this.circuitBreaker.tryAcquire()) {
                usedFallback = true;
                break;
            }

            try {
                const parsed = await this.submitBatch(batch);
                predictions.push(...parsed.predictions);
                batchesSubmitted += 1;
                this.circuitBreaker.reportSuccess();
            } catch {
                this.circuitBreaker.reportFailure();
                usedFallback = true;
                break;
            }
        }

        if (usedFallback) {
            this.failedRequests += 1;
            this.fallbacksUsed += 1;
        } else {
            this.successfulRequests += 1;
        }

        return this.result(events.length, predictions, batchesSubmitted, startedAt, usedFallback);
    }

    public getStats(): AiClientStats {
        return Object.freeze({
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            fallbacksUsed: this.fallbacksUsed,
            averageLatencyMs:
                this.totalRequests === 0 ? 0 : this.totalLatencyMs / this.totalRequests,
            circuitState: this.circuitBreaker.getState(),
        });
    }

    private async submitBatch(
        events: readonly FeatureEnrichedEvent[],
    ): Promise<ParsedAiResponse> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await this.fetchImplementation(this.detectionUrl, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    events: events.map((event) => ({
                        event_id: event.event_id,
                        features: selectAiFeatureVector(event.features),
                    })),
                    threshold: this.threshold,
                    include_shap: this.includeShap,
                }),
                signal: controller.signal,
            });

            if (!response.ok) throw new Error("AI Engine returned a non-success status.");
            const body: unknown = await response.json();
            return parseDetectionResponse(body, events);
        } finally {
            clearTimeout(timeout);
        }
    }

    private result(
        eventsSubmitted: number,
        predictions: readonly AiDetectionPrediction[],
        batchesSubmitted: number,
        startedAt: number,
        usedFallback: boolean,
    ): AiDetectionResult {
        const requestDurationMs = Math.max(0, this.now() - startedAt);
        this.totalLatencyMs += requestDurationMs;

        return Object.freeze({
            predictions: Object.freeze([...predictions]),
            stats: Object.freeze({
                eventsSubmitted,
                eventsScored: predictions.length,
                anomaliesDetected: predictions.filter((item) => item.isAnomaly).length,
                batchesSubmitted,
                requestDurationMs,
                usedFallback,
            }),
        });
    }
}

function parseDetectionResponse(
    value: unknown,
    events: readonly FeatureEnrichedEvent[],
): ParsedAiResponse {
    if (!isObject(value)) throw new Error("AI Engine response must be an object.");

    const modelVersion = requireNonBlankString(value.model_version, "model_version");
    const processingTimeMs = requireNonNegativeNumber(
        value.processing_time_ms,
        "processing_time_ms",
    );
    const eventsProcessed = requireNonNegativeInteger(
        value.events_processed,
        "events_processed",
    );
    const anomaliesDetected = requireNonNegativeInteger(
        value.anomalies_detected,
        "anomalies_detected",
    );

    if (!Array.isArray(value.predictions)) throw new Error("predictions must be an array.");
    if (eventsProcessed !== events.length || value.predictions.length !== events.length) {
        throw new Error("AI Engine response cardinality does not match the request.");
    }

    const expectedIds = new Set(events.map((event) => event.event_id));
    const seenIds = new Set<string>();
    const predictions = value.predictions.map((item) => {
        if (!isObject(item)) throw new Error("prediction must be an object.");

        const eventId = requireNonBlankString(item.event_id, "prediction.event_id");
        if (!expectedIds.has(eventId) || seenIds.has(eventId)) {
            throw new Error("AI Engine returned an unknown or duplicate event_id.");
        }
        seenIds.add(eventId);

        return Object.freeze({
            eventId,
            anomalyScore: requireProbability(item.anomaly_score, "anomaly_score"),
            isAnomaly: requireBoolean(item.is_anomaly, "is_anomaly"),
            confidence: requireProbability(item.confidence, "confidence"),
            shapExplanation: parseShapExplanation(item.shap_explanation),
            modelVersion,
            processingTimeMs,
        });
    });

    if (predictions.filter((item) => item.isAnomaly).length !== anomaliesDetected) {
        throw new Error("AI Engine anomaly count is inconsistent with predictions.");
    }

    return { predictions: Object.freeze(predictions), modelVersion };
}

function parseShapExplanation(value: unknown): AiShapExplanation | null {
    if (value === null || value === undefined) return null;
    if (!isObject(value) || !Array.isArray(value.features)) {
        throw new Error("shap_explanation is invalid.");
    }

    return Object.freeze({
        baseValue: requireFiniteNumber(value.base_value, "shap_explanation.base_value"),
        features: Object.freeze(
            value.features.map((feature) => {
                if (!isObject(feature)) throw new Error("SHAP feature must be an object.");
                return Object.freeze({
                    name: requireNonBlankString(feature.name, "SHAP feature name"),
                    value: requireFiniteNumber(feature.value, "SHAP feature value"),
                    shapValue: requireFiniteNumber(feature.shap_value, "SHAP feature value"),
                });
            }),
        ),
    });
}

function assertUniqueEventIds(events: readonly FeatureEnrichedEvent[]): void {
    const ids = new Set<string>();
    for (const event of events) {
        if (event.event_id.trim().length === 0 || ids.has(event.event_id)) {
            throw new Error("AI detection requires unique, non-blank event IDs.");
        }
        ids.add(event.event_id);
    }
}

function createDetectionUrl(baseUrl: string): URL {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("AI Engine base URL must use HTTP or HTTPS.");
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
        throw new Error("AI Engine base URL must not contain credentials.");
    }
    parsed.pathname = "/api/v1/detect/anomaly";
    parsed.search = "";
    parsed.hash = "";
    return parsed;
}

function requireBatchSize(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
        throw new Error("AI batchSize must be an integer between 1 and 100.");
    }
    return value;
}

function requirePositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`AI ${name} must be a positive integer.`);
    }
    return value;
}

function requireProbability(value: unknown, name: string): number {
    const numberValue = requireFiniteNumber(value, name);
    if (numberValue < 0 || numberValue > 1) throw new Error(`${name} must be between 0 and 1.`);
    return numberValue;
}

function requireFiniteNumber(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number.`);
    }
    return value;
}

function requireNonNegativeNumber(value: unknown, name: string): number {
    const numberValue = requireFiniteNumber(value, name);
    if (numberValue < 0) throw new Error(`${name} must be non-negative.`);
    return numberValue;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
}

function requireNonBlankString(value: unknown, name: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${name} must be a non-blank string.`);
    }
    return value;
}

function requireBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
    return value;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
