import assert from "node:assert/strict";
import test from "node:test";

import {
    CollectorTrustConfigurationError,
    createConfiguredCollectorTrustStore,
} from "../../../src/modules/ingestion/infrastructure/collector-trust.configuration.js";

const VALID_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

test("creates a trust store from valid Collector configuration", async () => {
    const trustStore = createConfiguredCollectorTrustStore({
        collectorId: "collector-dev-01",
        keyId: "collector-key-dev-01",
        secretBase64Url: VALID_SECRET,
    });

    const resolution = await trustStore.resolveKey("collector-dev-01", "collector-key-dev-01");

    assert.equal(resolution.trusted, true);

    if (resolution.trusted) {
        assert.equal(resolution.key.byteLength, 48);

        assert.deepEqual(Buffer.from(resolution.key), Buffer.from(VALID_SECRET, "base64url"));
    }
});

test("rejects an unknown Collector after configuration", async () => {
    const trustStore = createConfiguredCollectorTrustStore({
        collectorId: "collector-dev-01",
        keyId: "collector-key-dev-01",
        secretBase64Url: VALID_SECRET,
    });

    const resolution = await trustStore.resolveKey("collector-unknown-01", "collector-key-dev-01");

    assert.deepEqual(resolution, {
        trusted: false,
        reason: "unknown_collector",
    });
});

test("rejects an unknown key ID after configuration", async () => {
    const trustStore = createConfiguredCollectorTrustStore({
        collectorId: "collector-dev-01",
        keyId: "collector-key-dev-01",
        secretBase64Url: VALID_SECRET,
    });

    const resolution = await trustStore.resolveKey("collector-dev-01", "collector-key-unknown");

    assert.deepEqual(resolution, {
        trusted: false,
        reason: "unknown_key_id",
    });
});

test("rejects an invalid Collector ID", () => {
    expectConfigurationFailure(
        {
            collectorId: "Collector DEV 01",
            keyId: "collector-key-dev-01",
            secretBase64Url: VALID_SECRET,
        },
        "COLLECTOR_ID",
    );
});

test("rejects an invalid key ID", () => {
    expectConfigurationFailure(
        {
            collectorId: "collector-dev-01",
            keyId: "collector key dev 01",
            secretBase64Url: VALID_SECRET,
        },
        "COLLECTOR_HMAC_KEY_ID",
    );
});

test("rejects a short HMAC secret", () => {
    expectConfigurationFailure(
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-dev-01",
            secretBase64Url: "too-short",
        },
        "exactly 64",
    );
});

test("rejects padded base64", () => {
    expectConfigurationFailure(
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-dev-01",
            secretBase64Url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4=",
        },
        "unpadded base64url",
    );
});

test("rejects ordinary base64 characters", () => {
    const invalidSecret = `${VALID_SECRET.slice(0, 63)}+`;

    expectConfigurationFailure(
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-dev-01",
            secretBase64Url: invalidSecret,
        },
        "unpadded base64url",
    );
});

test("rejects whitespace around the HMAC secret", () => {
    expectConfigurationFailure(
        {
            collectorId: "collector-dev-01",
            keyId: "collector-key-dev-01",
            secretBase64Url: ` ${VALID_SECRET}`,
        },
        "exactly 64",
    );
});

test("configuration errors never expose the submitted secret", () => {
    const submittedSecret = "THIS_SECRET_MUST_NEVER_APPEAR_IN_AN_ERROR";

    assert.throws(
        () =>
            createConfiguredCollectorTrustStore({
                collectorId: "collector-dev-01",
                keyId: "collector-key-dev-01",
                secretBase64Url: submittedSecret,
            }),
        (error: unknown) => {
            assert.ok(error instanceof CollectorTrustConfigurationError);

            assert.equal(error.message.includes(submittedSecret), false);

            return true;
        },
    );
});

interface ConfigurationInput {
    readonly collectorId: string;
    readonly keyId: string;
    readonly secretBase64Url: string;
}

function expectConfigurationFailure(
    configuration: ConfigurationInput,
    expectedMessage: string,
): void {
    assert.throws(
        () => createConfiguredCollectorTrustStore(configuration),
        (error: unknown) => {
            assert.ok(error instanceof CollectorTrustConfigurationError);

            assert.match(error.message, new RegExp(expectedMessage, "u"));

            assert.equal(error.message.includes(configuration.secretBase64Url), false);

            return true;
        },
    );
}
