import type {
    CollectorEnvelope,
    CollectorMessage,
    JsonObject,
    JsonValue,
} from "../domain/collector-contract.types.js";

import type {
    ICollectorEnvelopeValidator,
    ICollectorMessageSchemaValidator,
    ICollectorMessageSemanticValidator,
    ICollectorMessageVerifier,
    ICollectorTrustStore,
    IHmacSha256Verifier,
    IJsonCanonicalizer,
    ISha256Hasher,
    IStrictJsonParser,
    VerifiedCollectorMessage,
} from "../domain/collector-verification.contracts.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../domain/collector-verification.errors.js";

const MAX_BATCH_FILE_BYTES = 8 * 1024 * 1024;
const HMAC_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface VerifyCollectorMessageDependencies {
    readonly parser: IStrictJsonParser;
    readonly envelopeValidator: ICollectorEnvelopeValidator;
    readonly trustStore: ICollectorTrustStore;
    readonly canonicalizer: IJsonCanonicalizer;
    readonly hmacVerifier: IHmacSha256Verifier;
    readonly schemaValidator: ICollectorMessageSchemaValidator;
    readonly semanticValidator: ICollectorMessageSemanticValidator;
    readonly sha256Hasher: ISha256Hasher;
}

export class VerifyCollectorMessageService implements ICollectorMessageVerifier {

    public constructor(private readonly dependencies: VerifyCollectorMessageDependencies) { }

    public async verify(input: Uint8Array): Promise<VerifiedCollectorMessage> {
        const stableInput = new Uint8Array(input);

        this.validateFileSize(stableInput);

        const parsedValue = this.dependencies.parser.parse(stableInput);

        const envelope = this.dependencies.envelopeValidator.validate(parsedValue);

        const trust = await this.dependencies.trustStore.resolveKey(
            envelope.collector_id,
            envelope.integrity.key_id,
        );

        if (!trust.trusted) {
            if (trust.reason === "unknown_collector") {
                throw new CollectorVerificationError(
                    COLLECTOR_VERIFICATION_ERROR_CODES.UNKNOWN_COLLECTOR,
                    "identity",
                    "Collector identity is not trusted.",
                );
            }

            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNKNOWN_KEY_ID,
                "identity",
                "Collector key ID is not trusted.",
            );
        }

        const unsignedValue = removeIntegrityValue(parsedValue);

        const canonicalUnsignedBytes = this.dependencies.canonicalizer.canonicalize(unsignedValue);

        const signature = envelope.integrity.value;

        if (!HMAC_SIGNATURE_PATTERN.test(signature)) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.MALFORMED_HMAC,
                "integrity",
                "Collector HMAC has an invalid format.",
            );
        }

        const validSignature = this.dependencies.hmacVerifier.verify(
            canonicalUnsignedBytes,
            trust.key,
            signature,
        );

        if (!validSignature) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_HMAC,
                "integrity",
                "Collector message HMAC verification failed.",
            );
        }

        const message = this.dependencies.schemaValidator.validate(parsedValue);

        this.dependencies.semanticValidator.validate(message);

        const canonicalUnsignedSha256 =
            this.dependencies.sha256Hasher.digest(canonicalUnsignedBytes);

        return {
            message,
            canonicalUnsignedBytes,
            canonicalUnsignedSha256,
        };
    }

    private validateFileSize(input: Uint8Array): void {
        if (input.byteLength > MAX_BATCH_FILE_BYTES) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.FILE_TOO_LARGE,
                "precheck",
                "Collector message exceeds the 8 MiB file limit.",
                {
                    fileSizeBytes: input.byteLength,
                    maximumBytes: MAX_BATCH_FILE_BYTES,
                },
            );
        }
    }
}

function removeIntegrityValue(value: JsonValue): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
            "schema",
            "Collector message must be a JSON object.",
        );
    }

    const original = value as JsonObject;
    const integrity = original.integrity;

    if (typeof integrity !== "object" || integrity === null || Array.isArray(integrity)) {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
            "schema",
            "Collector message integrity object is invalid.",
        );
    }
    if (!isJsonObject(integrity)) {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_JSON,
            "parsing",
            "Collector integrity field must be a JSON object.",
        );
    }

    const unsignedIntegrity = Object.create(null) as Record<string, JsonValue>;

    for (const key of Object.keys(integrity)) {
        if (key !== "value") {
            unsignedIntegrity[key] = integrity[key];
        }
    }

    const unsignedDocument = Object.create(null) as Record<string, JsonValue>;

    for (const key of Object.keys(original)) {
        if (key !== "integrity") {
            unsignedDocument[key] = original[key];
        }
    }

    unsignedDocument.integrity = unsignedIntegrity;

    return unsignedDocument;
}

function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
