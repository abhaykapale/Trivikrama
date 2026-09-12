import { link, lstat, mkdir, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type {
  IQuarantineFileRequeuer,
  RequeueQuarantinedFileResult,
} from "../domain/collector-monitoring.contracts.js";
import { QuarantineRetryError } from "../domain/quarantine-retry.errors.js";
import { parseQuarantineFileName } from "./quarantine-file-name.js";

export interface FilesystemQuarantineFileRequeuerConfiguration {
  readonly handoffRoot: string;
}

/** Restores a quarantine file to incoming without replacing an existing batch. */
export class FilesystemQuarantineFileRequeuer
  implements IQuarantineFileRequeuer
{
  private readonly root: string;
  private readonly incomingDirectory: string;
  private readonly quarantineDirectory: string;

  public constructor(
    configuration: FilesystemQuarantineFileRequeuerConfiguration,
  ) {
    if (configuration.handoffRoot.trim().length === 0) {
      throw new Error("Collector handoff root is required.");
    }

    this.root = resolve(configuration.handoffRoot);
    this.incomingDirectory = join(this.root, "incoming");
    this.quarantineDirectory = join(this.root, "quarantine");
  }

  public async requeue(
    filename: string,
  ): Promise<RequeueQuarantinedFileResult> {
    if (filename !== basename(filename)) {
      throw new QuarantineRetryError(
        "INVALID_FILENAME",
        "The quarantine filename is invalid.",
      );
    }

    const identity = parseQuarantineFileName(filename);

    if (identity === undefined) {
      throw new QuarantineRetryError(
        "INVALID_FILENAME",
        "The quarantine filename is invalid.",
      );
    }

    await requireSafeDirectory(this.root);
    await requireSafeDirectory(this.incomingDirectory);
    await requireSafeDirectory(this.quarantineDirectory);

    const sourcePath = join(this.quarantineDirectory, filename);
    await requireSafeQuarantineFile(sourcePath);

    const collectorDirectory = join(
      this.incomingDirectory,
      identity.collectorId,
    );
    await ensureSafeCollectorDirectory(collectorDirectory);

    const incomingFileName = `batch_${identity.batchId}.json`;
    const destinationPath = join(collectorDirectory, incomingFileName);

    try {
      await link(sourcePath, destinationPath);
    } catch (error: unknown) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new QuarantineRetryError(
          "REQUEUE_DESTINATION_EXISTS",
          "A batch with this identity already exists in the incoming directory.",
        );
      }

      if (hasErrorCode(error, "ENOENT")) {
        throw new QuarantineRetryError(
          "QUARANTINE_FILE_NOT_FOUND",
          "The quarantine file was not found.",
        );
      }

      throw new QuarantineRetryError(
        "REQUEUE_FAILED",
        "The quarantine file could not be requeued.",
      );
    }

    try {
      await unlink(sourcePath);
    } catch {
      // The destination is complete and retry-safe. Preserve both links rather
      // than risk deleting a file already claimed by the ingestion process.
      throw new QuarantineRetryError(
        "REQUEUE_FAILED",
        "The file was restored but quarantine cleanup did not complete.",
      );
    }

    return {
      filename,
      incomingRelativePath: `incoming/${identity.collectorId}/${incomingFileName}`,
    };
  }
}

async function requireSafeDirectory(path: string): Promise<void> {
  try {
    const stats = await lstat(path);

    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new QuarantineRetryError(
        "UNSAFE_HANDOFF_PATH",
        "Collector handoff directories must be real directories.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof QuarantineRetryError) {
      throw error;
    }

    if (hasErrorCode(error, "ENOENT")) {
      throw new QuarantineRetryError(
        "UNSAFE_HANDOFF_PATH",
        "The Collector handoff layout is unavailable.",
      );
    }

    throw new QuarantineRetryError(
      "REQUEUE_FAILED",
      "The Collector handoff layout could not be inspected.",
    );
  }
}

async function requireSafeQuarantineFile(path: string): Promise<void> {
  try {
    const stats = await lstat(path);

    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new QuarantineRetryError(
        "UNSAFE_HANDOFF_PATH",
        "The quarantine entry must be a regular file.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof QuarantineRetryError) {
      throw error;
    }

    if (hasErrorCode(error, "ENOENT")) {
      throw new QuarantineRetryError(
        "QUARANTINE_FILE_NOT_FOUND",
        "The quarantine file was not found.",
      );
    }

    throw new QuarantineRetryError(
      "REQUEUE_FAILED",
      "The quarantine file could not be inspected.",
    );
  }
}

async function ensureSafeCollectorDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error: unknown) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw new QuarantineRetryError(
        "REQUEUE_FAILED",
        "The Collector incoming directory could not be prepared.",
      );
    }
  }

  await requireSafeDirectory(path);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
