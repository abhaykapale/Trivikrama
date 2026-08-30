import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { createConfiguredCollectorMessageVerifier } from "../../../src/modules/ingestion/composition/configured-ingestion-verification.dependencies.js";

import { CollectorVerificationError } from "../../../src/modules/ingestion/domain/collector-verification.errors.js";

import { CollectorTrustConfigurationError } from "../../../src/modules/ingestion/infrastructure/collector-trust.configuration.js";

const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

const contractRoot = findContractRoot();

const heartbeatBytes = readFileSync(join(contractRoot, "fixtures", "positive", "heartbeat.json"));

test("configured composition verifies an official signed heartbeat", async () => {
    const verifier = createConfiguredCollectorMessageVerifier({
        collectorId: "collector-dev-01",
        keyId: "collector-key-test-01",
        secretBase64Url: TEST_SECRET,
    });

    const result = await verifier.verify(heartbeatBytes);

    assert.equal(result.message.message_type, "heartbeat");

    assert.equal(result.message.collector_id, "collector-dev-01");

    assert.equal(result.message.integrity.key_id, "collector-key-test-01");
});

test("configured composition rejects an unprovisioned Collector", async () => {
    const verifier = createConfiguredCollectorMessageVerifier({
        collectorId: "collector-other-01",
        keyId: "collector-key-test-01",
        secretBase64Url: TEST_SECRET,
    });

    await assert.rejects(
        () => verifier.verify(heartbeatBytes),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "UNKNOWN_COLLECTOR" &&
                error.stage === "identity"
            );
        },
    );
});

test("configured composition rejects a message signed with a different secret", async () => {
    const wrongSecret = "AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

    const verifier = createConfiguredCollectorMessageVerifier({
        collectorId: "collector-dev-01",
        keyId: "collector-key-test-01",
        secretBase64Url: wrongSecret,
    });

    await assert.rejects(
        () => verifier.verify(heartbeatBytes),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "INVALID_HMAC" &&
                error.stage === "integrity"
            );
        },
    );
});

test("configured composition rejects malformed startup secret configuration", () => {
    assert.throws(
        () =>
            createConfiguredCollectorMessageVerifier({
                collectorId: "collector-dev-01",
                keyId: "collector-key-test-01",
                secretBase64Url: "too-short",
            }),
        (error: unknown) => {
            return error instanceof CollectorTrustConfigurationError;
        },
    );
});

function findContractRoot(): string {
    const candidates = [
        resolve(process.cwd(), "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
    ];

    for (const candidate of candidates) {
        if (existsSync(join(candidate, "fixtures", "positive", "heartbeat.json"))) {
            return candidate;
        }
    }

    throw new Error("ARCH-01 contract fixtures were not found.");
}
