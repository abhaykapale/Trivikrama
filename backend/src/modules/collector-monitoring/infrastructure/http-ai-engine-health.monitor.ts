import type {
  AiEngineHealthSnapshot,
  IAiEngineHealthMonitor,
} from "../domain/collector-monitoring.contracts.js";

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

const OFFLINE_SNAPSHOT: AiEngineHealthSnapshot = Object.freeze({
  status: "offline",
  modelVersion: null,
  uptimeSeconds: null,
  totalPredictions: null,
  avgLatencyMs: null,
  p99LatencyMs: null,
});

export interface HttpAiEngineHealthMonitorConfiguration {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly refreshIntervalMs?: number;
}

export interface HttpAiEngineHealthMonitorDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

interface CachedHealthSnapshot {
  readonly value: AiEngineHealthSnapshot;
  readonly expiresAt: number;
}

/**
 * Timeout-bounded, cached HTTP adapter for the AI Engine health contract.
 * Transport failures are operational state, so they map to `offline` rather
 * than escaping and failing the complete Collector monitoring response.
 */
export class HttpAiEngineHealthMonitor implements IAiEngineHealthMonitor {
  private readonly healthUrl: URL;
  private readonly timeoutMs: number;
  private readonly refreshIntervalMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private cached: CachedHealthSnapshot | null = null;
  private inFlight: Promise<AiEngineHealthSnapshot> | null = null;
  private activeController: AbortController | null = null;
  private closed = false;

  public constructor(
    configuration: HttpAiEngineHealthMonitorConfiguration,
    dependencies: HttpAiEngineHealthMonitorDependencies = {},
  ) {
    this.healthUrl = createHealthUrl(configuration.baseUrl);
    this.timeoutMs = requirePositiveInteger(
      configuration.timeoutMs,
      "AI Engine health timeout",
    );
    this.refreshIntervalMs = requirePositiveInteger(
      configuration.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
      "AI Engine health refresh interval",
    );
    this.fetchImplementation = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  public async getStatus(): Promise<AiEngineHealthSnapshot> {
    if (this.closed) {
      return OFFLINE_SNAPSHOT;
    }

    const now = this.now();

    if (this.cached !== null && now < this.cached.expiresAt) {
      return this.cached.value;
    }

    if (this.inFlight !== null) {
      return this.inFlight;
    }

    const request = this.requestStatus()
      .then((value) => {
        this.cached = {
          value,
          expiresAt: this.now() + this.refreshIntervalMs,
        };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = request;
    return request;
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.activeController?.abort();

    if (this.inFlight !== null) {
      await this.inFlight.catch(() => undefined);
    }
  }

  private async requestStatus(): Promise<AiEngineHealthSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    this.activeController = controller;

    try {
      const response = await this.fetchImplementation(this.healthUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const body = await readJson(response);

      if (body === null) {
        return degradedSnapshot();
      }

      return mapHealthResponse(response.ok, body);
    } catch {
      return OFFLINE_SNAPSHOT;
    } finally {
      clearTimeout(timeout);

      if (this.activeController === controller) {
        this.activeController = null;
      }
    }
  }
}

async function readJson(
  response: Response,
): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    const value: unknown = await response.json();

    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function mapHealthResponse(
  responseOk: boolean,
  body: Readonly<Record<string, unknown>>,
): AiEngineHealthSnapshot {
  const healthStatus = body.status;
  const modelLoaded = body.model_loaded;

  if (
    (healthStatus !== "healthy" && healthStatus !== "unhealthy") ||
    typeof modelLoaded !== "boolean"
  ) {
    return degradedSnapshot();
  }

  return {
    status:
      responseOk && healthStatus === "healthy" && modelLoaded
        ? "online"
        : "degraded",
    modelVersion: readNonBlankString(body.model_version),
    uptimeSeconds: readNonNegativeNumber(body.uptime_seconds),
    totalPredictions: readNonNegativeInteger(body.total_predictions),
    avgLatencyMs: readNonNegativeNumber(body.avg_latency_ms),
    p99LatencyMs: readNonNegativeNumber(body.p99_latency_ms),
  };
}

function degradedSnapshot(): AiEngineHealthSnapshot {
  return {
    ...OFFLINE_SNAPSHOT,
    status: "degraded",
  };
}

function readNonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createHealthUrl(baseUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("AI Engine base URL must be an absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("AI Engine base URL must use HTTP or HTTPS.");
  }

  parsed.pathname = "/api/v1/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}
