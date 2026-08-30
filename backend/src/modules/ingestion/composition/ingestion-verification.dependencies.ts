import { VerifyCollectorMessageService } from "../application/verify-collector-message.service.js";

import type {
    ICollectorMessageVerifier,
    ICollectorTrustStore,
} from "../domain/collector-verification.contracts.js";

import { CollectorEnvelopeValidator } from "../infrastructure/collector-envelope.validator.js";

import { CollectorMessageSchemaValidator } from "../infrastructure/collector-message.schemas.js";

import { CollectorMessageSemanticValidator } from "../infrastructure/collector-message.semantic.validator";

import { HmacSha256Verifier } from "../infrastructure/hmac-sha256.verifier.js";

import { Rfc8785Canonicalizer } from "../infrastructure/json/rfc8785-canonicalizer.js";

import { StrictJsonParser } from "../infrastructure/json/strict-json.parser.js";

import { Sha256Hasher } from "../infrastructure/sha256.hasher.js";

export interface IngestionVerificationDependencies {
    readonly trustStore: ICollectorTrustStore;
}

export function createCollectorMessageVerifier(
    dependencies: IngestionVerificationDependencies,
): ICollectorMessageVerifier {
    const strictJsonParser = new StrictJsonParser();

    const envelopeValidator = new CollectorEnvelopeValidator();

    const canonicalizer = new Rfc8785Canonicalizer();

    const hmacVerifier = new HmacSha256Verifier();

    const schemaValidator = new CollectorMessageSchemaValidator();

    const semanticValidator = new CollectorMessageSemanticValidator(strictJsonParser);

    const sha256Hasher = new Sha256Hasher();

    return new VerifyCollectorMessageService({
        parser: strictJsonParser,
        envelopeValidator,
        trustStore: dependencies.trustStore,
        canonicalizer,
        hmacVerifier,
        schemaValidator,
        semanticValidator,
        sha256Hasher,
    });
}
