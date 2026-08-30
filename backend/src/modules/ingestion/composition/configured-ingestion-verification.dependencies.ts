import type { ICollectorMessageVerifier } from "../domain/collector-verification.contracts.js";

import { createConfiguredCollectorTrustStore } from "../infrastructure/collector-trust.configuration.js";

import { createCollectorMessageVerifier } from "./ingestion-verification.dependencies.js";

export interface CollectorVerificationRuntimeConfiguration {
    readonly collectorId: string;
    readonly keyId: string;
    readonly secretBase64Url: string;
}

export function createConfiguredCollectorMessageVerifier(
    configuration: CollectorVerificationRuntimeConfiguration,
): ICollectorMessageVerifier {
    const trustStore = createConfiguredCollectorTrustStore({
        collectorId: configuration.collectorId,
        keyId: configuration.keyId,
        secretBase64Url: configuration.secretBase64Url,
    });

    return createCollectorMessageVerifier({
        trustStore,
    });
}
