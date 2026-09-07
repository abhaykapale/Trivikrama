import type { ICollectorFileIntake } from "../domain/collector-file-intake.contracts.js";
import type { CollectorProcessingJob } from "../domain/processing-queue.contracts.js";
import type {
    ProcessCollectorProcessingJobResult,
    ProcessCollectorProcessingJobService,
} from "./process-collector-processing-job.service.js";

export interface HandleCollectorProcessingJobDependencies {
    readonly processor: Pick<ProcessCollectorProcessingJobService, "execute">;

    readonly fileIntake: Pick<ICollectorFileIntake, "quarantineProcessingJob">;
}

/**
 * Completes one processing job after its integrity/archive decision.
 *
 * Infrastructure failures deliberately escape: BullMQ must retry them.
 */
export class HandleCollectorProcessingJobService {
    public constructor(private readonly dependencies: HandleCollectorProcessingJobDependencies) {}

    public async execute(
        job: CollectorProcessingJob,
    ): Promise<ProcessCollectorProcessingJobResult> {
        const result = await this.dependencies.processor.execute(job);

        if (result.status === "quarantine") {
            await this.dependencies.fileIntake.quarantineProcessingJob(job, result.reason);
        }

        return result;
    }
}
