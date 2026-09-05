import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import type {
    ClaimedCollectorBatchFile,
    CollectorBatchQuarantineReason,
    CollectorFileIntakeConfiguration,
    CollectorFileIntakeReport,
    CollectorFileRecoveryReport,
    ICollectorFileIntake,
    IgnoredCollectorFile,
    QuarantinedCollectorBatchFile,
} from "../domain/collector-file-intake.contracts.js";
import { MAX_COLLECTOR_BATCH_BYTES } from "../domain/collector-file-intake.contracts.js";
import {
    CollectorFileIntakeError,
    type CollectorFileIntakeStage,
} from "../domain/collector-file-intake.errors.js";

const COLLECTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLISHED_BATCH_FILE_PATTERN = new RegExp(
    `^batch_(${UUID_V4_PATTERN.source.slice(1, -1)})\\.json$`,
    "u",
);
const CLAIMED_BATCH_FILE_PATTERN = new RegExp(
    `^batch_(${UUID_V4_PATTERN.source.slice(1, -1)})__collector_([A-Za-z0-9_-]+)__claim_(${UUID_V4_PATTERN.source.slice(1, -1)})\\.json$`,
    "u",
);

interface CandidateBatchFile {
    readonly collectorId: string;
    readonly batchId: string;
    readonly fileName: string;
    readonly path: string;
}

interface IntakeLayout {
    readonly root: string;
    readonly incoming: string;
    readonly processing: string;
    readonly quarantine: string;
}

/**
 * Filesystem implementation of ARCH-01's claim boundary. A claim is a rename
 * within one configured handoff root, so a completed file has one owner even
 * when multiple backend processes discover it at the same time.
 */
export class CollectorFileIntakeService implements ICollectorFileIntake {
    private readonly layout: IntakeLayout;
    private readonly maxBatchBytes: number;

    public constructor(configuration: CollectorFileIntakeConfiguration) {
        const root = resolve(configuration.handoffRoot);
        this.layout = {
            root,
            incoming: join(root, "incoming"),
            processing: join(root, "processing"),
            quarantine: join(root, "quarantine"),
        };

        this.maxBatchBytes = configuration.maxBatchBytes ?? MAX_COLLECTOR_BATCH_BYTES;

        if (
            !Number.isSafeInteger(this.maxBatchBytes) ||
            this.maxBatchBytes <= 0 ||
            this.maxBatchBytes > MAX_COLLECTOR_BATCH_BYTES
        ) {
            throw new CollectorFileIntakeError(
                "INVALID_INTAKE_CONFIGURATION",
                "layout",
                "maxBatchBytes must be a positive safe integer no greater than the ARCH-01 8 MiB limit.",
                { maxBatchBytes: this.maxBatchBytes },
            );
        }
    }

    public async initialize(): Promise<void> {
        await this.ensureDirectory(this.layout.root, "layout");
        await this.ensureDirectory(this.layout.incoming, "layout");
        await this.ensureDirectory(this.layout.processing, "layout");
        await this.ensureDirectory(this.layout.quarantine, "layout");
    }

    public async claimPublishedBatches(): Promise<CollectorFileIntakeReport> {
        await this.initialize();

        const report: MutableIntakeReport = {
            claimed: [],
            quarantined: [],
            ignored: [],
        };

        const incomingEntries = await this.readDirectory(this.layout.incoming, "discovery");

        for (const entry of incomingEntries) {
            const collectorPath = join(this.layout.incoming, entry.name);

            if (!COLLECTOR_ID_PATTERN.test(entry.name)) {
                report.ignored.push(this.ignored(collectorPath, "INVALID_COLLECTOR_DIRECTORY"));
                continue;
            }

            const collectorStats = await this.safeLstat(collectorPath, "discovery");

            if (collectorStats.isSymbolicLink() || !collectorStats.isDirectory()) {
                report.ignored.push(
                    this.ignored(
                        collectorPath,
                        collectorStats.isSymbolicLink()
                            ? "SYMLINK_NOT_ALLOWED"
                            : "NON_DIRECTORY_COLLECTOR_ENTRY",
                    ),
                );
                continue;
            }

            const candidateEntries = await this.readDirectory(collectorPath, "discovery");

            for (const candidateEntry of candidateEntries) {
                const candidatePath = join(collectorPath, candidateEntry.name);
                const candidate = this.parsePublishedCandidate(
                    entry.name,
                    candidateEntry.name,
                    candidatePath,
                );

                if (candidate === undefined) {
                    report.ignored.push(
                        this.ignored(candidatePath, "TEMPORARY_OR_UNRECOGNIZED_FILE"),
                    );
                    continue;
                }

                const outcome = await this.claimCandidate(candidate, report.ignored);

                if (outcome === undefined) {
                    continue;
                }

                if (outcome.byteLength === 0) {
                    report.quarantined.push(
                        await this.quarantineClaimedBatch(outcome, "EMPTY_FILE"),
                    );
                    continue;
                }

                if (outcome.byteLength > this.maxBatchBytes) {
                    report.quarantined.push(
                        await this.quarantineClaimedBatch(outcome, "FILE_TOO_LARGE"),
                    );
                    continue;
                }

                report.claimed.push(outcome);
            }
        }

        return this.freezeIntakeReport(report);
    }

    public async recoverClaimedBatches(): Promise<CollectorFileRecoveryReport> {
        await this.initialize();

        const report: MutableRecoveryReport = {
            recovered: [],
            quarantined: [],
            ignored: [],
        };

        const processingEntries = await this.readDirectory(this.layout.processing, "recovery");

        for (const entry of processingEntries) {
            const processingPath = join(this.layout.processing, entry.name);
            const recovered = this.parseClaimedFileName(entry.name, processingPath);

            if (recovered === undefined) {
                report.ignored.push(this.ignored(processingPath, "MALFORMED_PROCESSING_FILE"));
                continue;
            }

            const stats = await this.safeLstat(processingPath, "recovery");

            if (stats.isSymbolicLink()) {
                report.ignored.push(this.ignored(processingPath, "SYMLINK_NOT_ALLOWED"));
                continue;
            }

            if (!stats.isFile()) {
                report.ignored.push(this.ignored(processingPath, "NON_REGULAR_FILE"));
                continue;
            }

            const claimed: ClaimedCollectorBatchFile = {
                ...recovered,
                byteLength: stats.size,
            };

            if (claimed.byteLength === 0) {
                report.quarantined.push(await this.quarantineClaimedBatch(claimed, "EMPTY_FILE"));
                continue;
            }

            if (claimed.byteLength > this.maxBatchBytes) {
                report.quarantined.push(await this.quarantineClaimedBatch(claimed, "FILE_TOO_LARGE"));
                continue;
            }

            report.recovered.push(claimed);
        }

        return {
            recovered: Object.freeze(report.recovered),
            quarantined: Object.freeze(report.quarantined),
            ignored: Object.freeze(report.ignored),
        };
    }

    public async quarantineClaimedBatch(
        claimedFile: ClaimedCollectorBatchFile,
        reason: CollectorBatchQuarantineReason,
    ): Promise<QuarantinedCollectorBatchFile> {
        await this.initialize();
        this.assertClaimBelongsToThisService(claimedFile);

        const stats = await this.safeLstat(claimedFile.processingPath, "quarantine");

        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new CollectorFileIntakeError(
                "CLAIMED_FILE_MISSING",
                "quarantine",
                "The claimed file is no longer a regular file in the processing directory.",
                { processingFileName: claimedFile.processingFileName },
            );
        }

        const quarantineFileName = this.createQuarantineFileName(claimedFile, reason);
        const quarantinePath = this.pathWithin(this.layout.quarantine, quarantineFileName);

        await this.renameClaimedFile(claimedFile.processingPath, quarantinePath, "quarantine");

        return {
            ...claimedFile,
            quarantineFileName,
            quarantinePath,
            quarantineReason: reason,
            quarantinedAt: new Date().toISOString(),
        };
    }

    private async claimCandidate(
        candidate: CandidateBatchFile,
        ignored: IgnoredCollectorFile[],
    ): Promise<ClaimedCollectorBatchFile | undefined> {
        const stats = await this.safeLstat(candidate.path, "claim", true);

        if (stats === undefined) {
            ignored.push(this.ignored(candidate.path, "CLAIM_RACE_LOST"));
            return undefined;
        }

        if (stats.isSymbolicLink()) {
            ignored.push(this.ignored(candidate.path, "SYMLINK_NOT_ALLOWED"));
            return undefined;
        }

        if (!stats.isFile()) {
            ignored.push(this.ignored(candidate.path, "NON_REGULAR_FILE"));
            return undefined;
        }

        const claimId = randomUUID();
        const processingFileName = this.createProcessingFileName(candidate, claimId);
        const processingPath = this.pathWithin(this.layout.processing, processingFileName);

        const claimed = await this.tryRename(candidate.path, processingPath);

        if (!claimed) {
            ignored.push(this.ignored(candidate.path, "CLAIM_RACE_LOST"));
            return undefined;
        }

        const claimedStats = await this.safeLstat(processingPath, "claim");

        if (claimedStats.isSymbolicLink() || !claimedStats.isFile()) {
            throw new CollectorFileIntakeError(
                "FILESYSTEM_OPERATION_FAILED",
                "claim",
                "A claimed file was not a regular file after the atomic rename.",
                { processingFileName },
            );
        }

        return {
            collectorId: candidate.collectorId,
            batchId: candidate.batchId,
            claimId,
            originalFileName: candidate.fileName,
            processingFileName,
            processingPath,
            byteLength: claimedStats.size,
            claimedAt: new Date().toISOString(),
        };
    }

    private parsePublishedCandidate(
        collectorId: string,
        fileName: string,
        path: string,
    ): CandidateBatchFile | undefined {
        const match = PUBLISHED_BATCH_FILE_PATTERN.exec(fileName);

        if (match === null) {
            return undefined;
        }

        return {
            collectorId,
            batchId: match[1],
            fileName,
            path,
        };
    }

    private parseClaimedFileName(
        fileName: string,
        processingPath: string,
    ): Omit<ClaimedCollectorBatchFile, "byteLength"> | undefined {
        const match = CLAIMED_BATCH_FILE_PATTERN.exec(fileName);

        if (match === null) {
            return undefined;
        }

        const collectorId = decodeCollectorId(match[2]);

        if (collectorId === undefined) {
            return undefined;
        }

        const batchId = match[1];
        const claimId = match[3];

        return {
            collectorId,
            batchId,
            claimId,
            originalFileName: `batch_${batchId}.json`,
            processingFileName: fileName,
            processingPath,
            claimedAt: null,
        };
    }

    private createProcessingFileName(candidate: CandidateBatchFile, claimId: string): string {
        return `batch_${candidate.batchId}__collector_${encodeCollectorId(candidate.collectorId)}__claim_${claimId}.json`;
    }

    private createQuarantineFileName(
        claimedFile: ClaimedCollectorBatchFile,
        reason: CollectorBatchQuarantineReason,
    ): string {
        return `batch_${claimedFile.batchId}__collector_${encodeCollectorId(claimedFile.collectorId)}__claim_${claimedFile.claimId}__${reason.toLowerCase()}__${randomUUID()}.json`;
    }

    private assertClaimBelongsToThisService(claimedFile: ClaimedCollectorBatchFile): void {
        if (
            !COLLECTOR_ID_PATTERN.test(claimedFile.collectorId) ||
            !UUID_V4_PATTERN.test(claimedFile.batchId) ||
            !UUID_V4_PATTERN.test(claimedFile.claimId) ||
            claimedFile.processingFileName !==
                this.createProcessingFileName(
                    {
                        collectorId: claimedFile.collectorId,
                        batchId: claimedFile.batchId,
                        fileName: claimedFile.originalFileName,
                        path: claimedFile.processingPath,
                    },
                    claimedFile.claimId,
                ) ||
            claimedFile.processingPath !==
                this.pathWithin(this.layout.processing, claimedFile.processingFileName)
        ) {
            throw new CollectorFileIntakeError(
                "INVALID_INTAKE_CONFIGURATION",
                "quarantine",
                "The claimed file does not belong to this intake service.",
            );
        }
    }

    private async ensureDirectory(path: string, stage: CollectorFileIntakeStage): Promise<void> {
        try {
            await mkdir(path, { recursive: true });
            const stats = await lstat(path);

            if (stats.isSymbolicLink() || !stats.isDirectory()) {
                throw new CollectorFileIntakeError(
                    "UNSAFE_HANDOFF_DIRECTORY",
                    stage,
                    "Collector handoff directories must be real directories, not symbolic links.",
                    { path },
                );
            }
        } catch (error) {
            if (error instanceof CollectorFileIntakeError) {
                throw error;
            }

            throw this.filesystemError(
                stage,
                "Unable to prepare the Collector handoff directory.",
                error,
                {
                    path,
                },
            );
        }
    }

    private async readDirectory(path: string, stage: CollectorFileIntakeStage) {
        try {
            const entries = await readdir(path, { withFileTypes: true });
            return entries.sort((left, right) => left.name.localeCompare(right.name));
        } catch (error) {
            throw this.filesystemError(
                stage,
                "Unable to read a Collector handoff directory.",
                error,
                {
                    path,
                },
            );
        }
    }

    private async safeLstat(path: string, stage: CollectorFileIntakeStage): Promise<Stats>;
    private async safeLstat(
        path: string,
        stage: CollectorFileIntakeStage,
        allowMissing: true,
    ): Promise<Stats | undefined>;
    private async safeLstat(
        path: string,
        stage: CollectorFileIntakeStage,
        allowMissing = false,
    ): Promise<Stats | undefined> {
        try {
            return await lstat(path);
        } catch (error) {
            if (allowMissing && hasCode(error, "ENOENT")) {
                return undefined;
            }

            throw this.filesystemError(
                stage,
                "Unable to inspect a Collector handoff path.",
                error,
                {
                    path,
                },
            );
        }
    }

    private async tryRename(sourcePath: string, destinationPath: string): Promise<boolean> {
        try {
            await rename(sourcePath, destinationPath);
            return true;
        } catch (error) {
            if (hasCode(error, "ENOENT")) {
                return false;
            }

            throw this.filesystemError(
                "claim",
                "Unable to atomically claim a published Collector batch.",
                error,
                { sourcePath: basename(sourcePath), destinationPath: basename(destinationPath) },
            );
        }
    }

    private async renameClaimedFile(
        sourcePath: string,
        destinationPath: string,
        stage: CollectorFileIntakeStage,
    ): Promise<void> {
        try {
            await rename(sourcePath, destinationPath);
        } catch (error) {
            throw this.filesystemError(stage, "Unable to move a claimed file.", error, {
                sourcePath: basename(sourcePath),
                destinationPath: basename(destinationPath),
            });
        }
    }

    private pathWithin(directory: string, fileName: string): string {
        const path = resolve(directory, fileName);
        const pathRelativeToDirectory = relative(directory, path);

        if (
            pathRelativeToDirectory === "" ||
            pathRelativeToDirectory.startsWith("..") ||
            pathRelativeToDirectory.includes("/") ||
            pathRelativeToDirectory.includes("\\")
        ) {
            throw new CollectorFileIntakeError(
                "INVALID_INTAKE_CONFIGURATION",
                "layout",
                "A generated Collector file path escaped its intended directory.",
            );
        }

        return path;
    }

    private ignored(path: string, reason: IgnoredCollectorFile["reason"]): IgnoredCollectorFile {
        return {
            relativePath: relative(this.layout.root, path),
            reason,
        };
    }

    private freezeIntakeReport(report: MutableIntakeReport): CollectorFileIntakeReport {
        return {
            claimed: Object.freeze(report.claimed),
            quarantined: Object.freeze(report.quarantined),
            ignored: Object.freeze(report.ignored),
        };
    }

    private filesystemError(
        stage: CollectorFileIntakeStage,
        message: string,
        cause: unknown,
        details: Record<string, string>,
    ): CollectorFileIntakeError {
        return new CollectorFileIntakeError(
            "FILESYSTEM_OPERATION_FAILED",
            stage,
            message,
            details,
            { cause },
        );
    }
}

interface MutableIntakeReport {
    claimed: ClaimedCollectorBatchFile[];
    quarantined: QuarantinedCollectorBatchFile[];
    ignored: IgnoredCollectorFile[];
}

interface MutableRecoveryReport {
    recovered: ClaimedCollectorBatchFile[];
    quarantined: QuarantinedCollectorBatchFile[];
    ignored: IgnoredCollectorFile[];
}

function encodeCollectorId(collectorId: string): string {
    return Buffer.from(collectorId, "utf8").toString("base64url");
}

function decodeCollectorId(value: string): string | undefined {
    try {
        const decoded = Buffer.from(value, "base64url").toString("utf8");

        if (!COLLECTOR_ID_PATTERN.test(decoded) || encodeCollectorId(decoded) !== value) {
            return undefined;
        }

        return decoded;
    } catch {
        return undefined;
    }
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
