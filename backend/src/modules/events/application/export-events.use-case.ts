import {
  EVENT_EXPORT_BATCH_SIZE,
  EVENT_EXPORT_MAX_RESULTS,
  eventQuerySystemClock,
  type EventInvestigationView,
  type EventQueryClock,
  type EventSearchInput,
  type IEventInvestigationRepository,
} from "../domain/event-query.contracts.js";
import { toRepositorySearchQuery } from "./event-query.helpers.js";

export type EventExportFormat = "csv" | "json";

export interface ExportEventsInput extends Omit<EventSearchInput, "page" | "limit"> {
  readonly format: EventExportFormat;
  readonly maxResults: number;
}

export interface ExportEventsResult {
  readonly contentType: string;
  readonly filename: string;
  readonly body: string;
  readonly exportedCount: number;
  readonly truncated: boolean;
}

export class ExportEventsUseCase {
  public constructor(
    private readonly repository: Pick<IEventInvestigationRepository, "search">,
    private readonly clock: EventQueryClock = eventQuerySystemClock,
  ) {}

  public async execute(input: ExportEventsInput): Promise<ExportEventsResult> {
    if (!Number.isInteger(input.maxResults) || input.maxResults < 1) {
      throw new Error("maxResults must be a positive integer");
    }
    const maxResults = Math.min(input.maxResults, EVENT_EXPORT_MAX_RESULTS);
    const base = toRepositorySearchQuery(
      { ...input, page: 1, limit: EVENT_EXPORT_BATCH_SIZE },
      this.clock,
    );
    const items: EventInvestigationView[] = [];
    let total = 0;

    while (items.length < maxResults) {
      const page = await this.repository.search({
        ...base,
        offset: items.length,
        limit: Math.min(EVENT_EXPORT_BATCH_SIZE, maxResults - items.length),
      });
      total = page.total;
      items.push(...page.items);
      if (page.items.length === 0 || items.length >= total) break;
    }

    const date = this.clock.now().toISOString().slice(0, 10).replaceAll("-", "");
    const truncated = total > items.length;

    if (input.format === "json") {
      return {
        contentType: "application/json; charset=utf-8",
        filename: `events_export_${date}.json`,
        body: JSON.stringify({
          data: items,
          export: { count: items.length, totalMatched: total, truncated },
        }),
        exportedCount: items.length,
        truncated,
      };
    }

    return {
      contentType: "text/csv; charset=utf-8",
      filename: `events_export_${date}.csv`,
      body: toCsv(items),
      exportedCount: items.length,
      truncated,
    };
  }
}

const CSV_HEADERS = [
  "event_id",
  "class_uid",
  "severity_id",
  "time",
  "message",
  "src_ip",
  "dst_ip",
  "username",
  "hostname",
  "collector_id",
  "batch_id",
] as const;

function toCsv(items: readonly EventInvestigationView[]): string {
  const rows = items.map((event) =>
    [
      event.eventId,
      event.classUid,
      event.severityId,
      event.time.toISOString(),
      event.message,
      event.srcEndpoint?.ip ?? "",
      event.dstEndpoint?.ip ?? "",
      event.actor?.user?.name ?? "",
      event.device?.hostname ?? "",
      event.ingestion.collectorId,
      event.ingestion.batchId,
    ]
      .map(csvCell)
      .join(","),
  );

  return `\uFEFF${CSV_HEADERS.join(",")}\r\n${rows.join("\r\n")}${rows.length > 0 ? "\r\n" : ""}`;
}

function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const formulaSafe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}
