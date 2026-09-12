import type { IQuarantineFileRequeuer } from "../domain/collector-monitoring.contracts.js";

export interface RetryQuarantinedFileInput {
  readonly filename: string;
}

export interface RetryQuarantinedFileResult {
  readonly filename: string;
  readonly status: "requeued";
  readonly message: string;
}

export class RetryQuarantinedFileUseCase {
  public constructor(private readonly requeuer: IQuarantineFileRequeuer) {}

  public async execute(
    input: RetryQuarantinedFileInput,
  ): Promise<RetryQuarantinedFileResult> {
    const filename = input.filename.trim();

    if (filename.length === 0) {
      throw new Error("filename must not be blank.");
    }

    const result = await this.requeuer.requeue(filename);

    return {
      filename: result.filename,
      status: "requeued",
      message: "File moved from quarantine back to processing queue",
    };
  }
}
