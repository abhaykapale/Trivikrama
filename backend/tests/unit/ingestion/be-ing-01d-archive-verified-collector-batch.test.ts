import assert from "node:assert/strict";
import test from "node:test";

import type {
    CreateRawEventArchiveIfAbsentResult,
    CreateRawEventArchiveInput,
} from "../../../src/database/repositories/mongodb/raw-event-archive.repository.js";
import { ArchiveVerifiedCollectorBatchService } from "../../../src/modules/ingestion/application/archive-verified-collector-batch.service.js";

class FakeRawEventArchive {
    public readonly receivedInputs: CreateRawEventArchiveInput[] = [];

    public constructor(private readonly result: CreateRawEventArchiveIfAbsentResult) {}

    public async createIfAbsent(
        input: CreateRawEventArchiveInput,
    ): Promise<CreateRawEventArchiveIfAbsentResult> {
        this.receivedInputs.push(input);
        return this.result;
    }
}

function makeArchiveInput(
    canonicalUnsignedSha256 = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
): CreateRawEventArchiveInput {
    return {
        batch_id: "77d8092b-7f4a-4a8f-8e45-6b1fc5612d52",
        collector_id: "collector-dev-01",
        canonical_unsigned_sha256: canonicalUnsignedSha256,
        event_count: 1,
        schema_version: "1.0.0",
        events: [
            {
                message: "Failed password for root",
                class_uid: 3002,
            },
        ],
        file_size_bytes: 512,
        archived_at: new Date("2026-09-05T00:00:00.000Z"),
    };
}

test("archives a newly verified batch", async () => {
    const input = makeArchiveInput();
    const repository = new FakeRawEventArchive({
        status: "created",
        document: input,
    });

    const service = new ArchiveVerifiedCollectorBatchService({
        rawEventArchive: repository,
    });

    const result = await service.execute(input);

    assert.deepEqual(result, {
        status: "archived",
        document: input,
    });
    assert.deepEqual(repository.receivedInputs, [input]);
});

test("accepts a replay when the existing digest matches", async () => {
    const input = makeArchiveInput();
    const existingArchive = {
        ...input,
        archived_at: new Date("2026-09-04T00:00:00.000Z"),
    };

    const service = new ArchiveVerifiedCollectorBatchService({
        rawEventArchive: new FakeRawEventArchive({
            status: "already_exists",
            document: existingArchive,
        }),
    });

    const result = await service.execute(input);

    assert.deepEqual(result, {
        status: "already_archived",
        document: existingArchive,
    });
});

test("flags a batch ID reused for different verified content", async () => {
    const input = makeArchiveInput();
    const existingDigest =
        "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

    const service = new ArchiveVerifiedCollectorBatchService({
        rawEventArchive: new FakeRawEventArchive({
            status: "already_exists",
            document: makeArchiveInput(existingDigest),
        }),
    });

    const result = await service.execute(input);

    assert.deepEqual(result, {
        status: "batch_id_collision",
        batchId: input.batch_id,
        existingCanonicalUnsignedSha256: existingDigest,
    });
});
