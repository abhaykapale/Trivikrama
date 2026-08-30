import type { ICollectorTrustStore } from "../domain/collector-verification.contracts.js";

import { InMemoryCollectorTrustStore } from "./collector-trust.store.js";

const COLLECTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const HMAC_SECRET_PATTERN = /^[A-Za-z0-9_-]{64}$/;

const EXPECTED_HMAC_KEY_BYTES = 48;

export interface CollectorTrustConfiguration {
    readonly collectorId: string;
    readonly keyId: string;
    readonly secretBase64Url: string;
}

export class CollectorTrustConfigurationError extends Error {
    public constructor(message: string) {
        super(message);

        this.name = "CollectorTrustConfigurationError";

        Object.setPrototypeOf(this, CollectorTrustConfigurationError.prototype);
    }
}

export function createConfiguredCollectorTrustStore(
    configuration: CollectorTrustConfiguration,
): ICollectorTrustStore {
    validateCollectorId(configuration.collectorId);
    validateKeyId(configuration.keyId);

    const decodedSecret = decodeHmacSecret(configuration.secretBase64Url);

    return new InMemoryCollectorTrustStore([
        {
            collectorId: configuration.collectorId,
            keyId: configuration.keyId,
            key: decodedSecret,
        },
    ]);
}

function validateCollectorId(collectorId: string): void {
    if (!COLLECTOR_ID_PATTERN.test(collectorId)) {
        throw new CollectorTrustConfigurationError(
            "COLLECTOR_ID must be between 1 and 64 characters and contain only lowercase letters, numbers, periods, underscores, or hyphens.",
        );
    }
}

function validateKeyId(keyId: string): void {
    if (!KEY_ID_PATTERN.test(keyId)) {
        throw new CollectorTrustConfigurationError(
            "COLLECTOR_HMAC_KEY_ID must be between 1 and 64 characters and contain only letters, numbers, periods, underscores, or hyphens.",
        );
    }
}

function decodeHmacSecret(secretBase64Url: string): Uint8Array {
    if (!HMAC_SECRET_PATTERN.test(secretBase64Url)) {
        throw new CollectorTrustConfigurationError(
            "COLLECTOR_HMAC_SECRET must contain exactly 64 unpadded base64url characters.",
        );
    }

    const decodedSecret = Buffer.from(secretBase64Url, "base64url");

    if (decodedSecret.length !== EXPECTED_HMAC_KEY_BYTES) {
        throw new CollectorTrustConfigurationError(
            "COLLECTOR_HMAC_SECRET must decode to exactly 48 bytes.",
        );
    }

    return new Uint8Array(decodedSecret);
}
