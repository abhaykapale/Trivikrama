import type {
    CreateRawEventArchiveInput,
    IRawEventArchiveRepository,
    RawEventArchiveDocument,
} from "../../../database/repositories/mongodb/raw-event-archive.repository.js";

export type ArchiveVerifiedCollectorBatchResult =
    | {
          readonly status: "archived";
          readonly document: RawEventArchiveDocument;
      }
    | {
          readonly status: "already_archived";
          readonly document: RawEventArchiveDocument;
      }
    | {
          readonly status: "batch_id_collision";
          readonly batchId: string;
          readonly existingCanonicalUnsignedSha256: string;
      };

export interface ArchiveVerifiedCollectorBatchDependencies {
    readonly rawEventArchive: Pick<IRawEventArchiveRepository, "createIfAbsent">;
}

/**
 * This service must only receive a batch that was already verified by the
 * collector HMAC/canonicalization boundary.
 */
export class ArchiveVerifiedCollectorBatchService {
    public constructor(private readonly dependencies: ArchiveVerifiedCollectorBatchDependencies) {}

    public async execute(
        input: CreateRawEventArchiveInput,
    ): Promise<ArchiveVerifiedCollectorBatchResult> {
        const archiveResult = await this.dependencies.rawEventArchive.createIfAbsent(input);

        if (archiveResult.status === "created") {
            return {
                status: "archived",
                document: archiveResult.document,
            };
        }

        if (archiveResult.document.canonical_unsigned_sha256 === input.canonical_unsigned_sha256) {
            return {
                status: "already_archived",
                document: archiveResult.document,
            };
        }

        return {
            status: "batch_id_collision",
            batchId: input.batch_id,
            existingCanonicalUnsignedSha256: archiveResult.document.canonical_unsigned_sha256,
        };
    }
}
