import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { MAX_COLLECTOR_BATCH_BYTES } from "../../ingestion/domain/collector-file-intake.contracts.js";
import type {
  IQuarantineFileCatalog,
  ListQuarantinedFileRecordsInput,
  QuarantinedFileRecord,
  QuarantinedFileRecordPage,
} from "../domain/collector-monitoring.contracts.js";
import { parseQuarantineFileName } from "./quarantine-file-name.js";

export interface FilesystemQuarantineFileCatalogConfiguration {
  readonly handoffRoot: string;
}

/** Lists bounded metadata for backend-created quarantine files without following links. */
export class FilesystemQuarantineFileCatalog
  implements IQuarantineFileCatalog
{
  private readonly handoffRoot: string;
  private readonly quarantineDirectory: string;

  public constructor(
    configuration: FilesystemQuarantineFileCatalogConfiguration,
  ) {
    if (configuration.handoffRoot.trim().length === 0) {
      throw new Error("Collector handoff root is required.");
    }

    this.handoffRoot = resolve(configuration.handoffRoot);
    this.quarantineDirectory = join(this.handoffRoot, "quarantine");
  }

  public async list(
    input: ListQuarantinedFileRecordsInput,
  ): Promise<QuarantinedFileRecordPage> {
    if (!(await isSafeDirectory(this.handoffRoot))) {
      return { items: [], total: 0 };
    }

    if (!(await isSafeDirectory(this.quarantineDirectory))) {
      return { items: [], total: 0 };
    }

    const entries = await readdir(this.quarantineDirectory, {
      withFileTypes: true,
    });
    const records: QuarantinedFileRecord[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        continue;
      }

      const identity = parseQuarantineFileName(entry.name);

      if (identity === undefined) {
        continue;
      }

      const path = join(this.quarantineDirectory, entry.name);

      try {
        const stats = await lstat(path);

        if (
          stats.isSymbolicLink() ||
          !stats.isFile() ||
          stats.size > MAX_COLLECTOR_BATCH_BYTES
        ) {
          continue;
        }

        records.push({
          fileName: entry.name,
          collectorId: identity.collectorId,
          batchId: identity.batchId,
          reason: identity.reason,
          quarantinedAt: stats.ctime,
          fileSizeBytes: stats.size,
          eventCount: await readEventCount(path),
        });
      } catch (error: unknown) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }

    records.sort(
      (left, right) =>
        right.quarantinedAt.getTime() - left.quarantinedAt.getTime() ||
        left.fileName.localeCompare(right.fileName),
    );

    return {
      items: records.slice(input.offset, input.offset + input.limit),
      total: records.length,
    };
  }
}

async function readEventCount(path: string): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return 0;
    }

    const eventCount = (parsed as Record<string, unknown>).event_count;

    return Number.isSafeInteger(eventCount) && (eventCount as number) >= 0
      ? (eventCount as number)
      : 0;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return 0;
    }

    throw error;
  }
}

async function isSafeDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);

    if (stats.isSymbolicLink()) {
      throw new Error("Collector monitoring refuses symbolic-link directories.");
    }

    if (!stats.isDirectory()) {
      throw new Error("Collector monitoring requires real directories.");
    }

    return true;
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
