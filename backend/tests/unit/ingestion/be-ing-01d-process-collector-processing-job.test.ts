import assert from "node:assert/strict";
import test from "node:test";

import type {
    CreateRawEventArchiveInput,
    RawEventArchiveDocument,
} from "../../../src/database/repositories/mongodb/raw-event-archive.repository.js";
import type { ArchiveVerifiedCollectorBatchResult } from "../../../src/modules/ingestion/application/archive-verified-collector-batch.service.js";
import { ProcessCollectorProcessingJobService } from "../../../src/modules/ingestion/application/process-collector-processing-job.service.js";
import type { ClaimedCollectorBatchReadRequest } from "../../../src/modules/ingestion/domain/claimed-collector-batch-reader.contracts.js";
import type {
    ICollectorMessageVerifier,
    Sha256Digest,
    VerifiedCollectorMessage,
} from "../../../src/modules/ingestion/domain/collector-verification.contracts.js";
import { CollectorVerificationError } from "../../../src/modules/ingestion/domain/collector-verification.errors.js";
import type { CollectorProcessingJob } from "../../../src/modules/ingestion/domain/processing-queue.contracts.js";
import type { ICollectorEventNormalizer } from "../../../src/modules/ingestion/domain/collector-event-normalization.contracts.js";
import type { PersistNormalizedCollectorEventsResult } from "../../../src/modules/ingestion/application/persist-normalized-collector-events.service.js";
import { DeterministicFeatureExtractor } from "../../../src/modules/feature-extraction/index.js";

const BATCH_ID = "77d8092b-6bd8-4acd-ab16-bd56707a1377";
const COLLECTOR_ID = "collector-dev-01";
const DIGEST = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_DIGEST = "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

class FakeReader {
    public readonly requests: ClaimedCollectorBatchReadRequest[] = [];

    public constructor(private readonly outcome: Uint8Array | Error) {}

    public async read(request: ClaimedCollectorBatchReadRequest): Promise<Uint8Array> {
        this.requests.push(request);

        if (this.outcome instanceof Error) {
            throw this.outcome;
        }

        return this.outcome;
    }
}

class FakeVerifier implements Pick<ICollectorMessageVerifier, "verify"> {
    public readonly inputs: Uint8Array[] = [];

    public constructor(private readonly outcome: VerifiedCollectorMessage | Error) {}

    public async verify(input: Uint8Array): Promise<VerifiedCollectorMessage> {
        this.inputs.push(input);

        if (this.outcome instanceof Error) {
            throw this.outcome;
        }

        return this.outcome;
    }
}

class FakeRawBatchArchive {
    public readonly inputs: CreateRawEventArchiveInput[] = [];

    public constructor(private readonly outcome: ArchiveVerifiedCollectorBatchResult) {}

    public async execute(
        input: CreateRawEventArchiveInput,
    ): Promise<ArchiveVerifiedCollectorBatchResult> {
        this.inputs.push(input);
        return this.outcome;
    }
}

class FakeNormalizer implements ICollectorEventNormalizer {
    public normalize() {
        return {
            events: [],
            stats: {
                totalEvents: 0,
                schemaValid: 0,
                schemaInvalid: 0,
            },
        };
    }
}

class FakeNormalizedEventPersistence {
    public async execute(): Promise<PersistNormalizedCollectorEventsResult> {
        return {
            status: "persisted",
            insertedCount: 0,
            alreadyPresentCount: 0,
        };
    }
}

class FakeDetection {
    public calls = 0;

    public async execute() {
        this.calls += 1;
        return {
            evaluation: {
                rulesEvaluated: 0,
                rulesMatched: 0,
                alertsGenerated: 0,
                evaluationDurationMs: 0,
                eventsEvaluated: 0,
            },
            insertedAlerts: 0,
            alreadyPresentAlerts: 0,
        };
    }
}

class FakeAiDetection {
    public calls = 0;

    public constructor(private readonly usedFallback = false) {}

    public async execute() {
        this.calls += 1;
        return {
            eventsSubmitted: 0,
            eventsScored: 0,
            anomaliesDetected: 0,
            insertedResults: 0,
            alreadyPresentResults: 0,
            usedFallback: this.usedFallback,
        };
    }
}

function createJob(): CollectorProcessingJob {
    return {
        batchId: BATCH_ID,
        collectorId: COLLECTOR_ID,
        processingFileName:
            "batch_77d8092b-6bd8-4acd-ab16-bd56707a1377__collector_Y29sbGVjdG9yLWRldi0wMQ__claim_e3f25231-fe99-4458-84bb-c181fe73b1f4.json",
        byteLength: 512,
        canonicalUnsignedSha256: DIGEST,
        enqueuedAt: "2026-09-07T00:00:00.000Z",
    };
}

function createVerifiedBatch(canonicalUnsignedSha256 : Sha256Digest = DIGEST): VerifiedCollectorMessage {


    return {
        message: {
            contract_version: "1.0.0",
            message_type: "event_batch",
            collector_id: COLLECTOR_ID,
            integrity: {
                algorithm: "HMAC-SHA256",
                key_id: "collector-key-test-01",
                value: "test-signature",
            },
            batch_id: BATCH_ID,
            created_at: "2026-09-07T00:00:00.000Z",
            ocsf_schema_version: "1.1.0",
            event_count: 0,
            events: [],
        },
        canonicalUnsignedBytes: new Uint8Array([1, 2, 3]),
        canonicalUnsignedSha256,
    };
}

function createArchiveDocument(): RawEventArchiveDocument {
    return {
        batch_id: BATCH_ID,
        collector_id: COLLECTOR_ID,
        canonical_unsigned_sha256: DIGEST,
        event_count: 0,
        schema_version: "1.1.0",
        events: [],
        file_size_bytes: 512,
        archived_at: new Date("2026-09-07T00:00:00.000Z"),
    };
}

function createService(
    reader: FakeReader,
    verifier: FakeVerifier,
    archive: FakeRawBatchArchive,
    detection: FakeDetection = new FakeDetection(),
    aiDetection: FakeAiDetection = new FakeAiDetection(),
): ProcessCollectorProcessingJobService {
    return new ProcessCollectorProcessingJobService({
        reader,
        verifier,
        rawBatchArchive: archive,
        normalizer: new FakeNormalizer(),
        normalizedEventPersistence: new FakeNormalizedEventPersistence(),
        featureExtractor: new DeterministicFeatureExtractor(),
        detection,
        aiDetection,
        now: () => new Date("2026-09-07T00:00:00.000Z"),
    });
}

test("archives a safely reread and reverified queued batch", async () => {
    const reader = new FakeReader(new Uint8Array([1, 2, 3]));
    const verifier = new FakeVerifier(createVerifiedBatch());
    const archive = new FakeRawBatchArchive({
        status: "archived",
        document: createArchiveDocument(),
    });

    const result = await createService(reader, verifier, archive).execute(createJob());

    assert.deepEqual(result, {
        status: "processed",
        archiveStatus: "archived",
        totalEvents: 0,
        insertedEvents: 0,
        alreadyPresentEvents: 0,
        generatedAlerts: 0,
        insertedAlerts: 0,
        alreadyPresentAlerts: 0,
        aiEventsScored: 0,
        aiAnomaliesDetected: 0,
        insertedAiResults: 0,
        alreadyPresentAiResults: 0,
        aiUsedFallback: false,
    });
    assert.deepEqual(reader.requests, [createJob()]);
    assert.equal(verifier.inputs.length, 1);
    assert.equal(archive.inputs.length, 1);
    assert.equal(archive.inputs[0]?.batch_id, BATCH_ID);
    assert.equal(archive.inputs[0]?.canonical_unsigned_sha256, DIGEST);
    assert.equal(archive.inputs[0]?.file_size_bytes, 512);
});

test("accepts an already archived batch with the same digest", async () => {
    const result = await createService(
        new FakeReader(new Uint8Array([1])),
        new FakeVerifier(createVerifiedBatch()),
        new FakeRawBatchArchive({
            status: "already_archived",
            document: createArchiveDocument(),
        }),
    ).execute(createJob());

    assert.deepEqual(result, {
        status: "processed",
        archiveStatus: "already_archived",
        totalEvents: 0,
        insertedEvents: 0,
        alreadyPresentEvents: 0,
        generatedAlerts: 0,
        insertedAlerts: 0,
        alreadyPresentAlerts: 0,
        aiEventsScored: 0,
        aiAnomaliesDetected: 0,
        insertedAiResults: 0,
        alreadyPresentAiResults: 0,
        aiUsedFallback: false,
    });
});

test("finishes rule processing when AI activates graceful fallback", async () => {
    const rules = new FakeDetection();
    const ai = new FakeAiDetection(true);
    const result = await createService(
        new FakeReader(new Uint8Array([1])),
        new FakeVerifier(createVerifiedBatch()),
        new FakeRawBatchArchive({
            status: "archived",
            document: createArchiveDocument(),
        }),
        rules,
        ai,
    ).execute(createJob());

    assert.equal(result.status, "processed");
    if (result.status === "processed") assert.equal(result.aiUsedFallback, true);
    assert.equal(rules.calls, 1);
    assert.equal(ai.calls, 1);
});

test("quarantines a batch that fails worker-side HMAC verification", async () => {
    const result = await createService(
        new FakeReader(new Uint8Array([1])),
        new FakeVerifier(
            new CollectorVerificationError(
                "INVALID_HMAC",
                "integrity",
                "The submitted HMAC is invalid.",
            ),
        ),
        new FakeRawBatchArchive({
            status: "archived",
            document: createArchiveDocument(),
        }),
    ).execute(createJob());

    assert.deepEqual(result, {
        status: "quarantine",
        reason: "INVALID_HMAC",
    });
});

test("quarantines when the verified digest differs from queued metadata", async () => {
    const archive = new FakeRawBatchArchive({
        status: "archived",
        document: createArchiveDocument(),
    });

    const result = await createService(
        new FakeReader(new Uint8Array([1])),
        new FakeVerifier(createVerifiedBatch(OTHER_DIGEST)),
        archive,
    ).execute(createJob());

    assert.deepEqual(result, {
        status: "quarantine",
        reason: "BATCH_DIGEST_MISMATCH",
    });
    assert.equal(archive.inputs.length, 0);
});

test("quarantines a batch ID collision", async () => {
    const result = await createService(
        new FakeReader(new Uint8Array([1])),
        new FakeVerifier(createVerifiedBatch()),
        new FakeRawBatchArchive({
            status: "batch_id_collision",
            batchId: BATCH_ID,
            existingCanonicalUnsignedSha256: OTHER_DIGEST,
        }),
    ).execute(createJob());

    assert.deepEqual(result, {
        status: "quarantine",
        reason: "BATCH_ID_COLLISION",
    });
});

test("rethrows a filesystem failure so BullMQ can retry it", async () => {
    await assert.rejects(
        createService(
            new FakeReader(new Error("temporary filesystem failure")),
            new FakeVerifier(createVerifiedBatch()),
            new FakeRawBatchArchive({
                status: "archived",
                document: createArchiveDocument(),
            }),
        ).execute(createJob()),
        /temporary filesystem failure/u,
    );
});
