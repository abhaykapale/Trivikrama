import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
    CollectorVerificationError,
    createCollectorMessageVerifier,
    InMemoryCollectorTrustStore,
} from "../../../src/modules/ingestion/index.js";

import type { CollectorVerificationErrorCode } from "../../../src/modules/ingestion/index.js";

interface TestKeyFixture {
    readonly key_id: string;
    readonly secret_base64url: string;
}

interface SigningVector {
    readonly name: string;
    readonly fixture: string;
    readonly canonical_unsigned_base64: string;
    readonly canonical_unsigned_sha256: string;
    readonly expected_hmac_base64url: string;
}

interface SigningVectorsFixture {
    readonly contract_version: string;
    readonly vectors: readonly SigningVector[];
}

const CONTRACT_ROOT = findContractRoot();
const FIXTURES_ROOT = join(CONTRACT_ROOT, "fixtures");

const testKey = readJson<TestKeyFixture>(join(FIXTURES_ROOT, "test-key.json"));

const signingVectors = readJson<SigningVectorsFixture>(join(FIXTURES_ROOT, "signing-vectors.json"));

const trustStore = new InMemoryCollectorTrustStore([
    {
        collectorId: "collector-dev-01",
        keyId: testKey.key_id,
        key: Buffer.from(testKey.secret_base64url, "base64url"),
    },
]);

const verifier = createCollectorMessageVerifier({
    trustStore,
});

for (const vector of signingVectors.vectors) {
    test(`verifies official signing vector: ${vector.name}`, async () => {
        const fixtureBytes = readFileSync(join(CONTRACT_ROOT, vector.fixture));

        const result = await verifier.verify(fixtureBytes);

        assert.equal(result.message.contract_version, signingVectors.contract_version);

        assert.equal(
            Buffer.from(result.canonicalUnsignedBytes).toString("base64"),
            vector.canonical_unsigned_base64,
        );

        assert.equal(result.canonicalUnsignedSha256, vector.canonical_unsigned_sha256);

        assert.equal(result.message.integrity.value, vector.expected_hmac_base64url);
    });
}

const negativeCases: readonly {
    readonly name: string;
    readonly fixture: string;
    readonly expectedCode: CollectorVerificationErrorCode;
}[] = [
    {
        name: "rejects a tampered signed batch",
        fixture: "negative/batch-tampered.json",
        expectedCode: "INVALID_HMAC",
    },
    {
        name: "rejects an event-count mismatch",
        fixture: "negative/batch-count-mismatch.json",
        expectedCode: "EVENT_COUNT_MISMATCH",
    },
    {
        name: "rejects an inconsistent OCSF mapping",
        fixture: "negative/batch-ocsf-mismatch.json",
        expectedCode: "OCSF_MAPPING_MISMATCH",
    },
    {
        name: "rejects Collector-emitted offline status",
        fixture: "negative/heartbeat-offline-status.json",
        expectedCode: "INVALID_HEARTBEAT",
    },
    {
        name: "rejects a mismatched rejection digest",
        fixture: "negative/rejection-digest-mismatch.json",
        expectedCode: "REJECTION_PAYLOAD_MISMATCH",
    },
    {
        name: "rejects duplicate JSON object keys",
        fixture: "negative/duplicate-key.json",
        expectedCode: "DUPLICATE_JSON_KEY",
    },
];

for (const negativeCase of negativeCases) {
    test(negativeCase.name, async () => {
        const fixtureBytes = readFileSync(join(FIXTURES_ROOT, negativeCase.fixture));

        await assert.rejects(
            () => verifier.verify(fixtureBytes),
            (error: unknown) => {
                return (
                    error instanceof CollectorVerificationError &&
                    error.code === negativeCase.expectedCode &&
                    error.disposition === "quarantine"
                );
            },
        );
    });
}

test("rejects an unknown Collector before accepting the message", async () => {
    const fixturePath = join(FIXTURES_ROOT, "positive", "heartbeat.json");

    const heartbeat = readJson<Record<string, unknown>>(fixturePath);

    heartbeat.collector_id = "collector-unknown-01";

    const bytes = new TextEncoder().encode(JSON.stringify(heartbeat));

    await assert.rejects(
        () => verifier.verify(bytes),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "UNKNOWN_COLLECTOR" &&
                error.stage === "identity"
            );
        },
    );
});

test("rejects an unknown key ID", async () => {
    const fixturePath = join(FIXTURES_ROOT, "positive", "heartbeat.json");

    const heartbeat = readJson<{
        integrity: {
            key_id: string;
        };
    }>(fixturePath);

    heartbeat.integrity.key_id = "collector-key-unknown";

    const bytes = new TextEncoder().encode(JSON.stringify(heartbeat));

    await assert.rejects(
        () => verifier.verify(bytes),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "UNKNOWN_KEY_ID" &&
                error.stage === "identity"
            );
        },
    );
});

test("rejects a malformed HMAC", async () => {
    const fixturePath = join(FIXTURES_ROOT, "positive", "heartbeat.json");

    const heartbeat = readJson<{
        integrity: {
            value: string;
        };
    }>(fixturePath);

    heartbeat.integrity.value = "malformed-signature";

    const bytes = new TextEncoder().encode(JSON.stringify(heartbeat));

    await assert.rejects(
        () => verifier.verify(bytes),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "MALFORMED_HMAC" &&
                error.stage === "integrity"
            );
        },
    );
});

test("rejects a Collector file larger than 8 MiB", async () => {
    const oversizedInput = new Uint8Array(8 * 1024 * 1024 + 1);

    await assert.rejects(
        () => verifier.verify(oversizedInput),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "FILE_TOO_LARGE" &&
                error.stage === "precheck"
            );
        },
    );
});

function readJson<TValue>(filePath: string): TValue {
    return JSON.parse(readFileSync(filePath, "utf8")) as TValue;
}

function findContractRoot(): string {
    const candidates = [
        resolve(process.cwd(), "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
    ];

    for (const candidate of candidates) {
        if (existsSync(join(candidate, "fixtures", "test-key.json"))) {
            return candidate;
        }
    }

    throw new Error(
        "ARCH-01 contract fixtures were not found. Expected contracts/collector-ingress/v1 in the backend or Trivikrama repository.",
    );
}
