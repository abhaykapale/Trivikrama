import type { CollectorEnvelope, CollectorMessage, JsonValue } from "./collector-contract.types.js";

// -----------------------------------------------------------------------------
// Shared digest type
// -----------------------------------------------------------------------------

export type Sha256Digest = `sha256:${string}`;

// -----------------------------------------------------------------------------
// Strict JSON parsing
// -----------------------------------------------------------------------------

export interface IStrictJsonParser {
    parse(input: Uint8Array): JsonValue;
}

// -----------------------------------------------------------------------------
// Minimal envelope validation
// -----------------------------------------------------------------------------

export interface ICollectorEnvelopeValidator {
    validate(value: JsonValue): CollectorEnvelope;
}

// -----------------------------------------------------------------------------
// RFC 8785 canonical JSON
// -----------------------------------------------------------------------------

export interface IJsonCanonicalizer {
    canonicalize(value: JsonValue): Uint8Array;
}

// -----------------------------------------------------------------------------
// Collector trust resolution
// -----------------------------------------------------------------------------

export type CollectorTrustFailureReason = "unknown_collector" | "unknown_key_id";

export type CollectorTrustResolution =
    | {
          readonly trusted: true;
          readonly key: Uint8Array;
      }
    | {
          readonly trusted: false;
          readonly reason: CollectorTrustFailureReason;
      };

export interface ICollectorTrustStore {
    resolveKey(collectorId: string, keyId: string): Promise<CollectorTrustResolution>;
}

// -----------------------------------------------------------------------------
// HMAC verification
// -----------------------------------------------------------------------------

export interface IHmacSha256Verifier {
    verify(signingInput: Uint8Array, key: Uint8Array, submittedSignature: string): boolean;
}

// -----------------------------------------------------------------------------
// SHA-256 hashing
// -----------------------------------------------------------------------------

export interface ISha256Hasher {
    digest(input: Uint8Array): Sha256Digest;
}

// -----------------------------------------------------------------------------
// Complete message validation
// -----------------------------------------------------------------------------

export interface ICollectorMessageSchemaValidator {
    validate(value: JsonValue): CollectorMessage;
}

export interface ICollectorMessageSemanticValidator {
    validate(message: CollectorMessage): void;
}

// -----------------------------------------------------------------------------
// Successful verification result
// -----------------------------------------------------------------------------

export interface VerifiedCollectorMessage {
    readonly message: CollectorMessage;
    readonly canonicalUnsignedBytes: Uint8Array;
    readonly canonicalUnsignedSha256: Sha256Digest;
}

// -----------------------------------------------------------------------------
// Main verification boundary
// -----------------------------------------------------------------------------

export interface ICollectorMessageVerifier {
    verify(input: Uint8Array): Promise<VerifiedCollectorMessage>;
}


