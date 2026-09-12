import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { MAX_COLLECTOR_BATCH_BYTES } from "../../ingestion/domain/collector-file-intake.contracts.js";
import type {
  IQuarantineFileCatalog,
  ListQuarantinedFileRecordsInput,
  QuarantinedFileRecord,
  QuarantinedFileRecordPage,
} from "../domain/collector-monitoring.contracts.js";

const COLLECTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const UUID_V4_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const QUARANTINE_FILE_PATTERN = new RegExp(
  `^batch_(${UUID_V4_SOURCE})__collector_([A-Za-z0-9_-]+)__claim_${UUID_V4_SOURCE}__([a-z0-9_]+)__${UUID_V4_SOURCE}\\.json$`,
  "u",
);

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

interface QuarantineFileIdentity {
  readonly collectorId: string;
  readonly batchId: string;
  readonly reason: string;
}

function parseQuarantineFileName(
  fileName: string,
): QuarantineFileIdentity | undefined {
  const match = QUARANTINE_FILE_PATTERN.exec(fileName);

  if (match === null) {
    return undefined;
  }

  const collectorId = decodeCollectorId(match[2]);

  if (collectorId === undefined) {
    return undefined;
  }

  return {
    batchId: match[1],
    collectorId,
    reason: match[3].toUpperCase(),
  };
}

function decodeCollectorId(encoded: string): string | undefined {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const canonical = Buffer.from(decoded, "utf8").toString("base64url");

    return canonical === encoded && COLLECTOR_ID_PATTERN.test(decoded)
      ? decoded
      : undefined;
  } catch {
    return undefined;
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
