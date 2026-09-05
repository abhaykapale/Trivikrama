import { lstat, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { ClaimedCollectorBatchFile } from "../domain/collector-file-intake.contracts.js";
import { MAX_COLLECTOR_BATCH_BYTES } from "../domain/collector-file-intake.contracts.js";
import type { IClaimedCollectorBatchReader } from "../domain/claimed-collector-batch-reader.contracts.js";
import { CollectorFileIntakeError } from "../domain/collector-file-intake.errors.js";

export interface ClaimedCollectorBatchReaderConfiguration {
    /** The same COLLECTOR_DIR used by CollectorFileIntakeService. */
    readonly handoffRoot: string;

    /** Allows a smaller limit in tests; production cannot exceed 8 MB. */
    readonly maxBatchBytes?: number;
}

/**
 * Reads an already claimed Collector batch from the backend-owned processing
 * directory. It never accepts a path supplied directly by an external caller.
 */
export class ClaimedCollectorBatchReader implements IClaimedCollectorBatchReader {
    private readonly processingDirectory: string;
    private readonly maxBatchBytes: number;

    public constructor(configuration: ClaimedCollectorBatchReaderConfiguration) {
        const handoffRoot = resolve(configuration.handoffRoot);

        this.processingDirectory = join(handoffRoot, "processing");
        this.maxBatchBytes = configuration.maxBatchBytes ?? MAX_COLLECTOR_BATCH_BYTES;

        if (
            !Number.isSafeInteger(this.maxBatchBytes) ||
            this.maxBatchBytes <= 0 ||
            this.maxBatchBytes > MAX_COLLECTOR_BATCH_BYTES
        ) {
            throw new CollectorFileIntakeError(
                "INVALID_INTAKE_CONFIGURATION",
                "read",
                "maxBatchBytes must be a positive safe integer no greater than the ARCH-01 8 MiB limit.",
                { maxBatchBytes: this.maxBatchBytes },
            );
        }
    }

    public async read(claimedFile: ClaimedCollectorBatchFile): Promise<Uint8Array> {
        this.assertSafeClaimedPath(claimedFile);

        let stats;

        try {
            stats = await lstat(claimedFile.processingPath);
        } catch (error) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_MISSING",
                "read",
                "The claimed batch file no longer exists.",
                {
                    processingFileName: claimedFile.processingFileName,
                },
                { cause: error },
            );
        }

        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_NOT_REGULAR",
                "read",
                "The claimed batch file must be a regular file and not a symbolic link.",
                {
                    processingFileName: claimedFile.processingFileName,
                },
            );
        }

        if (stats.size !== claimedFile.byteLength || stats.size > this.maxBatchBytes) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_CHANGED",
                "read",
                "The claimed batch file changed after it was claimed.",
                {
                    expectedByteLength: claimedFile.byteLength,
                    actualByteLength: stats.size,
                    maxBatchBytes: this.maxBatchBytes,
                },
            );
        }

        let contents: Uint8Array;

        try {
            contents = new Uint8Array(await readFile(claimedFile.processingPath));
        } catch (error) {
            throw new CollectorFileIntakeError(
                "FILESYSTEM_OPERATION_FAILED",
                "read",
                "The claimed batch file could not be read.",
                {
                    processingFileName: claimedFile.processingFileName,
                },
                { cause: error },
            );
        }

        if (contents.byteLength !== stats.size) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_CHANGED",
                "read",
                "The claimed batch file changed while it was being read.",
                {
                    expectedByteLength: stats.size,
                    actualByteLength: contents.byteLength,
                },
            );
        }

        return contents;
    }

    private assertSafeClaimedPath(claimedFile: ClaimedCollectorBatchFile): void {
        const expectedPath = resolve(this.processingDirectory, claimedFile.processingFileName);

        const suppliedPath = resolve(claimedFile.processingPath);

        if (
            basename(suppliedPath) !== claimedFile.processingFileName ||
            suppliedPath !== expectedPath
        ) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_UNSAFE_PATH",
                "read",
                "The claimed batch path is outside the backend processing directory.",
                {
                    processingFileName: claimedFile.processingFileName,
                },
            );
        }
    }
}
