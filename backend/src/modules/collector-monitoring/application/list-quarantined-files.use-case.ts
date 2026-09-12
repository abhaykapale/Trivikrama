import type {
  IQuarantineFileCatalog,
  QuarantinedFileRecord,
} from "../domain/collector-monitoring.contracts.js";

export interface ListQuarantinedFilesInput {
  readonly page: number;
  readonly limit: number;
}

export interface QuarantinedFileView {
  readonly filePath: string;
  readonly originalPath: string;
  readonly error: string;
  readonly quarantinedAt: string;
  readonly fileSizeBytes: number;
  readonly eventCount: number;
}

export interface QuarantinePaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ListQuarantinedFilesResult {
  readonly data: readonly QuarantinedFileView[];
  readonly pagination: QuarantinePaginationView;
}

export class ListQuarantinedFilesUseCase {
  public constructor(private readonly catalog: IQuarantineFileCatalog) {}

  public async execute(
    input: ListQuarantinedFilesInput,
  ): Promise<ListQuarantinedFilesResult> {
    assertPositiveSafeInteger(input.page, "page");
    assertPositiveSafeInteger(input.limit, "limit");

    if (input.limit > 100) {
      throw new Error("limit must not exceed 100.");
    }

    const offset = (input.page - 1) * input.limit;

    if (!Number.isSafeInteger(offset)) {
      throw new Error("The requested quarantine page is too large.");
    }

    const result = await this.catalog.list({ offset, limit: input.limit });

    return {
      data: result.items.map(toView),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: result.total,
        totalPages:
          result.total === 0 ? 0 : Math.ceil(result.total / input.limit),
      },
    };
  }
}

function toView(record: QuarantinedFileRecord): QuarantinedFileView {
  return {
    filePath: `quarantine/${record.fileName}`,
    originalPath: `incoming/${record.collectorId}/batch_${record.batchId}.json`,
    error: record.reason,
    quarantinedAt: record.quarantinedAt.toISOString(),
    fileSizeBytes: record.fileSizeBytes,
    eventCount: record.eventCount,
  };
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}
