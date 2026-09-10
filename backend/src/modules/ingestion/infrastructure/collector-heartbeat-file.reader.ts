import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
    MAX_COLLECTOR_HEARTBEAT_BYTES,
    type CollectorHeartbeatSnapshot,
    type ICollectorHeartbeatFileReader,
} from "../domain/collector-heartbeat.contracts.js";
import {
    COLLECTOR_HEARTBEAT_ERROR_CODES,
    CollectorHeartbeatError,
} from "../domain/collector-heartbeat.errors.js";

const COLLECTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const HEARTBEAT_FILE_NAME = "heartbeat.json";

export interface CollectorHeartbeatFileReaderConfiguration {
    readonly handoffRoot: string;
    readonly collectorId: string;
    readonly maxHeartbeatBytes?: number;
}

/**
 * Reads the Collector-owned heartbeat snapshot without moving or deleting it.
 * The Collector publishes by atomically replacing heartbeat.json inside its
 * identity-scoped incoming directory.
 */
export class CollectorHeartbeatFileReader implements ICollectorHeartbeatFileReader {
    private readonly collectorId: string;
    private readonly collectorDirectory: string;
    private readonly heartbeatPath: string;
    private readonly maxHeartbeatBytes: number;

    public constructor(configuration: CollectorHeartbeatFileReaderConfiguration) {
        if (!COLLECTOR_ID_PATTERN.test(configuration.collectorId)) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.INVALID_CONFIGURATION,
                "collectorId is not valid for an identity-scoped heartbeat path.",
            );
        }

        const root = resolve(configuration.handoffRoot);
        this.collectorId = configuration.collectorId;
        this.collectorDirectory = join(root, "incoming", configuration.collectorId);
        this.heartbeatPath = join(this.collectorDirectory, HEARTBEAT_FILE_NAME);
        this.maxHeartbeatBytes =
            configuration.maxHeartbeatBytes ?? MAX_COLLECTOR_HEARTBEAT_BYTES;

        if (
            !Number.isSafeInteger(this.maxHeartbeatBytes) ||
            this.maxHeartbeatBytes <= 0 ||
            this.maxHeartbeatBytes > MAX_COLLECTOR_HEARTBEAT_BYTES
        ) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.INVALID_CONFIGURATION,
                "maxHeartbeatBytes must be a positive safe integer no greater than 64 KiB.",
            );
        }
    }

    public async read(): Promise<CollectorHeartbeatSnapshot | null> {
        const collectorStats = await this.tryLstat(this.collectorDirectory);

        if (collectorStats === null) {
            return null;
        }

        if (collectorStats.isSymbolicLink() || !collectorStats.isDirectory()) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_NOT_REGULAR,
                "The configured Collector heartbeat directory is not a regular directory.",
                { collectorId: this.collectorId },
            );
        }

        const heartbeatStats = await this.tryLstat(this.heartbeatPath);

        if (heartbeatStats === null) {
            return null;
        }

        if (heartbeatStats.isSymbolicLink() || !heartbeatStats.isFile()) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_NOT_REGULAR,
                "The Collector heartbeat path is not a regular file.",
                { collectorId: this.collectorId },
            );
        }

        if (heartbeatStats.size === 0) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_EMPTY,
                "The Collector heartbeat file is empty.",
                { collectorId: this.collectorId },
            );
        }

        if (heartbeatStats.size > this.maxHeartbeatBytes) {
            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_TOO_LARGE,
                "The Collector heartbeat file exceeds the 64 KiB limit.",
                {
                    collectorId: this.collectorId,
                    actualBytes: heartbeatStats.size,
                    maximumBytes: this.maxHeartbeatBytes,
                },
            );
        }

        let handle: FileHandle | undefined;

        try {
            const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
            handle = await open(this.heartbeatPath, constants.O_RDONLY | noFollow);
            const openedStats = await handle.stat();

            if (!openedStats.isFile() || openedStats.size !== heartbeatStats.size) {
                throw new CollectorHeartbeatError(
                    COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_CHANGED,
                    "The Collector heartbeat changed while it was being opened.",
                    { collectorId: this.collectorId },
                );
            }

            const contents = new Uint8Array(await handle.readFile());

            if (contents.byteLength !== openedStats.size) {
                throw new CollectorHeartbeatError(
                    COLLECTOR_HEARTBEAT_ERROR_CODES.HEARTBEAT_CHANGED,
                    "The Collector heartbeat changed while it was being read.",
                    { collectorId: this.collectorId },
                );
            }

            return {
                collectorId: this.collectorId,
                filePath: this.heartbeatPath,
                byteLength: contents.byteLength,
                contents,
            };
        } catch (error: unknown) {
            if (error instanceof CollectorHeartbeatError) {
                throw error;
            }

            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.FILESYSTEM_OPERATION_FAILED,
                "Unable to safely read the Collector heartbeat file.",
                { collectorId: this.collectorId },
            );
        } finally {
            await handle?.close().catch(() => undefined);
        }
    }

    private async tryLstat(path: string) {
        try {
            return await lstat(path);
        } catch (error: unknown) {
            if (hasCode(error, "ENOENT")) {
                return null;
            }

            throw new CollectorHeartbeatError(
                COLLECTOR_HEARTBEAT_ERROR_CODES.FILESYSTEM_OPERATION_FAILED,
                "Unable to inspect the Collector heartbeat path.",
                { collectorId: this.collectorId },
            );
        }
    }
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
