import type {
  AiEngineHealthSnapshot,
  IAiEngineHealthMonitor,
  ICollectorMonitoringRepository,
  IProcessingQueueMonitor,
  IQuarantineMonitor,
  MonitoredCollectorRecord,
  MonitoredCollectorStatus,
  ProcessingQueueStatusSnapshot,
  QuarantineStatusSnapshot,
} from "../domain/collector-monitoring.contracts.js";

export interface GetCollectorStatusInput {
  readonly orgId: string;
}

export interface CollectorStatusView {
  readonly collectorId: string;
  readonly status: MonitoredCollectorStatus;
  readonly lastHeartbeatAt: string | null;
  readonly filesProcessed: number;
  readonly eventsCollected: number;
  readonly eventsDropped: number;
  readonly errorsCount: number;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly diskAvailableBytes: number | null;
  readonly lastBatchId: string | null;
  readonly firstSeenAt: string;
}

export interface GetCollectorStatusResult {
  readonly collectors: readonly CollectorStatusView[];
  readonly queue: QueueStatusView;
  readonly quarantine: QuarantineStatusSnapshot;
  readonly aiEngine: AiEngineHealthSnapshot;
}

export interface QueueStatusView extends ProcessingQueueStatusSnapshot {
  /** Permanent ingestion failures stored in the filesystem quarantine. */
  readonly deadLettered: number;
}

export class GetCollectorStatusUseCase {
  public constructor(
    private readonly repository: ICollectorMonitoringRepository,
    private readonly queueMonitor: IProcessingQueueMonitor,
    private readonly quarantineMonitor: IQuarantineMonitor,
    private readonly aiEngineHealthMonitor: IAiEngineHealthMonitor,
  ) {}

  public async execute(
    input: GetCollectorStatusInput,
  ): Promise<GetCollectorStatusResult> {
    const orgId = input.orgId.trim();

    if (orgId.length === 0) {
      throw new Error("orgId must not be blank.");
    }

    const [records, queue, quarantine, aiEngine] = await Promise.all([
      this.repository.listByOrgId(orgId),
      this.queueMonitor.getStatus(),
      this.quarantineMonitor.getStatus(),
      this.aiEngineHealthMonitor.getStatus(),
    ]);

    return {
      collectors: records.map(toCollectorStatusView),
      queue: {
        ...queue,
        deadLettered: quarantine.count,
      },
      quarantine,
      aiEngine,
    };
  }
}

function toCollectorStatusView(
  record: MonitoredCollectorRecord,
): CollectorStatusView {
  const heartbeatMetrics = readObject(record.heartbeatData, "metrics");

  return {
    collectorId: record.collectorId,
    status: record.status,
    lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() ?? null,
    filesProcessed: record.filesProcessed,
    eventsCollected: record.eventsCollected,
    eventsDropped: record.eventsDropped,
    errorsCount: record.errorsCount,
    cpuPercent: record.cpuPercent,
    memoryMb: record.memoryMb,
    diskAvailableBytes: readNonNegativeNumber(
      heartbeatMetrics,
      "disk_available_bytes",
    ),
    lastBatchId: readNonBlankString(heartbeatMetrics, "last_batch_id"),
    firstSeenAt: record.firstSeenAt.toISOString(),
  };
}

function readObject(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const candidate = value[key];

  return typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
    ? (candidate as Readonly<Record<string, unknown>>)
    : {};
}

function readNonNegativeNumber(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const candidate = value[key];

  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0
    ? candidate
    : null;
}

function readNonBlankString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const candidate = value[key];

  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : null;
}
