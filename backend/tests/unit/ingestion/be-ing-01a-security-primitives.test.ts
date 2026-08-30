import assert from "node:assert/strict";
import test from "node:test";

import { CollectorVerificationError } from "../../../src/modules/ingestion/domain/collector-verification.errors.js";

import { InMemoryCollectorTrustStore } from "../../../src/modules/ingestion/infrastructure/collector-trust.store.js";

import { HmacSha256Verifier } from "../../../src/modules/ingestion/infrastructure/hmac-sha256.verifier.js";

import { Rfc8785Canonicalizer } from "../../../src/modules/ingestion/infrastructure/json/rfc8785-canonicalizer.js";

import { StrictJsonParser } from "../../../src/modules/ingestion/infrastructure/json/strict-json.parser.js";

const TEST_SECRET_BASE64URL = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

const TEST_SECRET = Buffer.from(TEST_SECRET_BASE64URL, "base64url");

test("StrictJsonParser rejects duplicate object properties", () => {
    const parser = new StrictJsonParser();

    const input = new TextEncoder().encode('{"collector_id":"trusted","collector_id":"attacker"}');

    assert.throws(
        () => parser.parse(input),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError &&
                error.code === "DUPLICATE_JSON_KEY" &&
                error.stage === "parsing"
            );
        },
    );
});

test("StrictJsonParser detects duplicate decoded property names", () => {
    const parser = new StrictJsonParser();

    const input = new TextEncoder().encode('{"name":"first","\\u006eame":"second"}');

    assert.throws(
        () => parser.parse(input),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError && error.code === "DUPLICATE_JSON_KEY"
            );
        },
    );
});

test("StrictJsonParser rejects a UTF-8 BOM", () => {
    const parser = new StrictJsonParser();

    const input = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"value":1}')]);

    assert.throws(
        () => parser.parse(input),
        (error: unknown) => {
            return (
                error instanceof CollectorVerificationError && error.code === "JSON_BOM_NOT_ALLOWED"
            );
        },
    );
});

test("StrictJsonParser rejects invalid UTF-8", () => {
    const parser = new StrictJsonParser();

    const invalidUtf8 = new Uint8Array([
        0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
    ]);

    assert.throws(
        () => parser.parse(invalidUtf8),
        (error: unknown) => {
            return error instanceof CollectorVerificationError && error.code === "INVALID_UTF8";
        },
    );
});

test("Rfc8785Canonicalizer sorts object keys recursively", () => {
    const canonicalizer = new Rfc8785Canonicalizer();

    const canonicalBytes = canonicalizer.canonicalize({
        z: true,
        nested: {
            second: 2,
            first: 1,
        },
        a: "value",
    });

    const canonicalJson = new TextDecoder().decode(canonicalBytes);

    assert.equal(canonicalJson, '{"a":"value","nested":{"first":1,"second":2},"z":true}');
});

test("Rfc8785Canonicalizer preserves array order", () => {
    const canonicalizer = new Rfc8785Canonicalizer();

    const canonicalBytes = canonicalizer.canonicalize({
        values: [3, 1, 2],
    });

    assert.equal(new TextDecoder().decode(canonicalBytes), '{"values":[3,1,2]}');
});

test("HmacSha256Verifier accepts the expected contract MAC", () => {
    const verifier = new HmacSha256Verifier();

    const canonicalUnsignedBytes = new TextEncoder().encode('{"a":1,"b":2}');

    const valid = verifier.verify(
        canonicalUnsignedBytes,
        TEST_SECRET,
        "dYbp3upcsmb6BP_v5j1VQ6AMkqzw3L0sJ-QiHkirkHo",
    );

    assert.equal(valid, true);
});

test("HmacSha256Verifier rejects a modified signature", () => {
    const verifier = new HmacSha256Verifier();

    const canonicalUnsignedBytes = new TextEncoder().encode('{"a":1,"b":2}');

    const valid = verifier.verify(
        canonicalUnsignedBytes,
        TEST_SECRET,
        "AYbp3upcsmb6BP_v5j1VQ6AMkqzw3L0sJ-QiHkirkHo",
    );

    assert.equal(valid, false);
});

test("HmacSha256Verifier rejects malformed base64url", () => {
    const verifier = new HmacSha256Verifier();

    const valid = verifier.verify(
        new TextEncoder().encode("{}"),
        TEST_SECRET,
        "not-a-valid-signature",
    );

    assert.equal(valid, false);
});

test("InMemoryCollectorTrustStore resolves a trusted key", async () => {
    const trustStore = new InMemoryCollectorTrustStore([
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-test-01",
            key: TEST_SECRET,
        },
    ]);

    const result = await trustStore.resolveKey("collector-dev-01", "collector-key-test-01");

    assert.equal(result.trusted, true);

    if (result.trusted) {
        assert.deepEqual(Buffer.from(result.key), TEST_SECRET);
    }
});

test("InMemoryCollectorTrustStore distinguishes unknown collectors and keys", async () => {
    const trustStore = new InMemoryCollectorTrustStore([
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-test-01",
            key: TEST_SECRET,
        },
    ]);

    const unknownCollector = await trustStore.resolveKey(
        "collector-unknown",
        "collector-key-test-01",
    );

    assert.deepEqual(unknownCollector, {
        trusted: false,
        reason: "unknown_collector",
    });

    const unknownKey = await trustStore.resolveKey("collector-dev-01", "collector-key-unknown");

    assert.deepEqual(unknownKey, {
        trusted: false,
        reason: "unknown_key_id",
    });
});

test("InMemoryCollectorTrustStore returns a defensive key copy", async () => {
    const trustStore = new InMemoryCollectorTrustStore([
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-test-01",
            key: TEST_SECRET,
        },
    ]);

    const first = await trustStore.resolveKey("collector-dev-01", "collector-key-test-01");

    assert.equal(first.trusted, true);

    if (!first.trusted) {
        return;
    }

    first.key[0] = 255;

    const second = await trustStore.resolveKey("collector-dev-01", "collector-key-test-01");

    assert.equal(second.trusted, true);

    if (second.trusted) {
        assert.equal(second.key[0], 0);
    }
});
