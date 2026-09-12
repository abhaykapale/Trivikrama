import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  IQuarantineMonitor,
  QuarantineStatusSnapshot,
} from "../domain/collector-monitoring.contracts.js";

export interface FilesystemQuarantineMonitorConfiguration {
  readonly handoffRoot: string;
}

/** Counts regular JSON files without following filesystem links. */
export class FilesystemQuarantineMonitor implements IQuarantineMonitor {
  private readonly handoffRoot: string;
  private readonly quarantineDirectory: string;

  public constructor(configuration: FilesystemQuarantineMonitorConfiguration) {
    if (configuration.handoffRoot.trim().length === 0) {
      throw new Error("Collector handoff root is required.");
    }

    this.handoffRoot = resolve(configuration.handoffRoot);
    this.quarantineDirectory = join(this.handoffRoot, "quarantine");
  }

  public async getStatus(): Promise<QuarantineStatusSnapshot> {
    if (!(await isSafeDirectory(this.handoffRoot))) {
      return { count: 0 };
    }

    if (!(await isSafeDirectory(this.quarantineDirectory))) {
      return { count: 0 };
    }

    const entries = await readdir(this.quarantineDirectory, {
      withFileTypes: true,
    });
    let count = 0;

    for (const entry of entries) {
      if (
        !entry.name.toLowerCase().endsWith(".json") ||
        entry.isSymbolicLink()
      ) {
        continue;
      }

      try {
        const stats = await lstat(join(this.quarantineDirectory, entry.name));

        if (!stats.isSymbolicLink() && stats.isFile()) {
          count += 1;
        }
      } catch (error: unknown) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }

    return { count };
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
