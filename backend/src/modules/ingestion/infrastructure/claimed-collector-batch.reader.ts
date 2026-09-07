import { lstat, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { MAX_COLLECTOR_BATCH_BYTES } from "../domain/collector-file-intake.contracts.js";
import { CollectorFileIntakeError } from "../domain/collector-file-intake.errors.js";
import type {
    ClaimedCollectorBatchReadRequest,
    IClaimedCollectorBatchReader,
} from "../domain/claimed-collector-batch-reader.contracts.js";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const CLAIMED_BATCH_FILE_PATTERN =
    /^batch_([0-9a-f-]+)__collector_([A-Za-z0-9_-]+)__claim_([0-9a-f-]+)\.json$/u;

export interface ClaimedCollectorBatchReaderConfiguration {
    readonly handoffRoot: string;
    readonly maxBatchBytes?: number;
}

export class ClaimedCollectorBatchReader implements IClaimedCollectorBatchReader {
    private readonly processingDirectory: string;
    private readonly maxBatchBytes: number;

    public constructor(configuration: ClaimedCollectorBatchReaderConfiguration) {
        this.processingDirectory = join(resolve(configuration.handoffRoot), "processing");
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
            );
        }
    }

    public async read(request: ClaimedCollectorBatchReadRequest): Promise<Uint8Array> {
        const processingPath = this.resolveSafeProcessingPath(request);

        if (
            !Number.isSafeInteger(request.byteLength) ||
            request.byteLength <= 0 ||
            request.byteLength > this.maxBatchBytes
        ) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_CHANGED",
                "read",
                "The queued byte length is not a valid claimed batch size.",
                {
                    byteLength: request.byteLength,
                    maxBatchBytes: this.maxBatchBytes,
                },
            );
        }

        let stats;

        try {
            stats = await lstat(processingPath);
        } catch {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_MISSING",
                "read",
                "The claimed batch file no longer exists in the processing directory.",
                { processingFileName: request.processingFileName },
            );
        }

        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_NOT_REGULAR",
                "read",
                "The claimed batch path is not a regular file.",
                { processingFileName: request.processingFileName },
            );
        }

        if (stats.size !== request.byteLength || stats.size > this.maxBatchBytes) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_CHANGED",
                "read",
                "The claimed batch file size changed after it was queued.",
                {
                    expectedByteLength: request.byteLength,
                    actualByteLength: stats.size,
                },
            );
        }

        let contents: Uint8Array;

        try {
            contents = new Uint8Array(await readFile(processingPath));
        } catch {
            throw new CollectorFileIntakeError(
                "FILESYSTEM_OPERATION_FAILED",
                "read",
                "Unable to read the claimed batch file.",
                { processingFileName: request.processingFileName },
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

    private resolveSafeProcessingPath(request: ClaimedCollectorBatchReadRequest): string {
        if (basename(request.processingFileName) !== request.processingFileName) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_UNSAFE_PATH",
                "read",
                "The queued processing file name must not contain path segments.",
                { processingFileName: request.processingFileName },
            );
        }

        const match = CLAIMED_BATCH_FILE_PATTERN.exec(request.processingFileName);

        if (match === null) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_UNSAFE_PATH",
                "read",
                "The queued processing file name has an invalid format.",
                { processingFileName: request.processingFileName },
            );
        }

        const [, fileBatchId, encodedCollectorId, claimId] = match;
        const fileCollectorId = decodeCollectorId(encodedCollectorId);

        if (
            !UUID_V4_PATTERN.test(request.batchId) ||
            fileBatchId !== request.batchId ||
            fileCollectorId !== request.collectorId ||
            !UUID_V4_PATTERN.test(claimId)
        ) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_UNSAFE_PATH",
                "read",
                "The queued processing file name does not match its collector and batch identity.",
                {
                    collectorId: request.collectorId,
                    batchId: request.batchId,
                    processingFileName: request.processingFileName,
                },
            );
        }

        return join(this.processingDirectory, request.processingFileName);
    }
}

    function decodeCollectorId(encodedCollectorId: string): string | undefined {
        try {
            const collectorId = Buffer.from(encodedCollectorId, "base64url").toString("utf8");

            const canonicalEncoding = Buffer.from(collectorId, "utf8").toString("base64url");

            return canonicalEncoding === encodedCollectorId ? collectorId : undefined;
        } catch {
            return undefined;
        }
    }
