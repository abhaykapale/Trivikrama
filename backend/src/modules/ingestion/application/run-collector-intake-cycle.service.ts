import type {
    ClaimedCollectorBatchFile,
    CollectorFileIntakeReport,
    CollectorFileRecoveryReport,
    ICollectorFileIntake,
} from "../domain/collector-file-intake.contracts.js";
import type {
    IClaimedCollectorBatchProcessor,
    VerifyAndQueueClaimedBatchResult,
} from "./verify-and-queue-claimed-batch.service.js";

export type ClaimedBatchProcessingOutcome =
    | {
          readonly claimedFile: ClaimedCollectorBatchFile;
          readonly result: VerifyAndQueueClaimedBatchResult;
      }
    | {
          readonly claimedFile: ClaimedCollectorBatchFile;
          readonly status: "retryable_failure";
          readonly errorName: string;
      };

export interface CollectorIntakeCycleReport {
    readonly recovery: CollectorFileRecoveryReport;
    readonly discovery: CollectorFileIntakeReport;
    readonly processed: readonly ClaimedBatchProcessingOutcome[];
}

export interface RunCollectorIntakeCycleDependencies {
    readonly fileIntake: ICollectorFileIntake;
    readonly claimedBatchProcessor: IClaimedCollectorBatchProcessor;
}

/**
 * Runs one complete safe intake cycle.
 *
 * 1. Recover batches left in processing/ after a restart.
 * 2. Claim newly published batches from incoming/.
 * 3. Verify and queue each claimed batch.
 *
 * A transient failure for one file does not prevent other files from being
 * processed. The claimed file stays in processing/ for a future retry.
 */
export class RunCollectorIntakeCycleService {
    public constructor(private readonly dependencies: RunCollectorIntakeCycleDependencies) {}

    public async execute(): Promise<CollectorIntakeCycleReport> {
        await this.dependencies.fileIntake.initialize();

        const recovery = await this.dependencies.fileIntake.recoverClaimedBatches();

        const discovery = await this.dependencies.fileIntake.claimPublishedBatches();

        const claimedFiles = [...recovery.recovered, ...discovery.claimed];

        const processed: ClaimedBatchProcessingOutcome[] = [];

        for (const claimedFile of claimedFiles) {
            processed.push(await this.processOneClaimedBatch(claimedFile));
        }

        return {
            recovery,
            discovery,
            processed: Object.freeze(processed),
        };
    }

    private async processOneClaimedBatch(
        claimedFile: ClaimedCollectorBatchFile,
    ): Promise<ClaimedBatchProcessingOutcome> {
        try {
            const result = await this.dependencies.claimedBatchProcessor.execute(claimedFile);

            return {
                claimedFile,
                result,
            };
        } catch (error) {
            return {
                claimedFile,
                status: "retryable_failure",
                errorName: error instanceof Error ? error.name : "UnknownError",
            };
        }
    }
}
