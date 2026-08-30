# Ingestion Module Architecture

The ingestion module verifies collector payloads before the backend treats them as trusted data. It also owns the filesystem claim boundary for collector batch files. This is a security boundary: untrusted input is parsed, envelope-checked, trust-validated, canonicalized, HMAC-verified, schema-checked, and semantically validated before it becomes a `VerifiedCollectorMessage`, while batch files are claimed and quarantined through a controlled handoff directory.

## Responsibility

- Validate collector ingress envelope and trust metadata.
- Build a trusted key store from runtime configuration.
- Verify HMAC integrity using a canonicalized payload representation.
- Reject malformed, untrusted, or semantically invalid collector messages.

## Folder and Dependency Map

```mermaid
flowchart TD
    CONTRACT["contracts/collector-ingress/v1/"]
    COMP["composition/"]
    APP["application/verify-collector-message.service.ts"]
    FILEINTAKE["infrastructure/collector-file-intake.service.ts"]
    DOMAIN["domain/collector-verification.contracts.ts"]
    FILEDOMAIN["domain/collector-file-intake.contracts.ts"]
    INFRA["infrastructure/"]

    COMP --> APP
    COMP --> FILEINTAKE
    APP --> DOMAIN
    APP --> INFRA
    FILEINTAKE --> FILEDOMAIN
    INFRA --> CONTRACT
```

## Composition Root

`createConfiguredCollectorMessageVerifier()` builds a trust store and passes it into `createCollectorMessageVerifier()`, which instantiates the actual parser, validators, canonicalizer, and HMAC verifier. `CollectorFileIntakeService` is a separate infrastructure component that claims published batch files from the collector handoff root before later processing steps consume them.

```mermaid
flowchart TD
    CONFIG["CollectorVerificationRuntimeConfiguration"]
    TRUSTCFG["createConfiguredCollectorTrustStore()"]
    TRUSTSTORE["CollectorTrustStore"]
    BUILDER["createConfiguredCollectorMessageVerifier(configuration)"]
    FACTORY["createCollectorMessageVerifier({ trustStore })"]
    PARSER["new StrictJsonParser()"]
    ENVVALID["new CollectorEnvelopeValidator()"]
    CANON["new Rfc8785Canonicalizer()"]
    HMAC["new HmacSha256Verifier()"]
    SCHEMA["new CollectorMessageSchemaValidator()"]
    SEM["new CollectorMessageSemanticValidator(strictJsonParser)"]
    HASH["new Sha256Hasher()"]
    SERVICE["new VerifyCollectorMessageService({ parser, envelopeValidator, trustStore, canonicalizer, hmacVerifier, schemaValidator, semanticValidator, sha256Hasher })"]

    CONFIG --> BUILDER
    BUILDER --> TRUSTCFG --> TRUSTSTORE
    TRUSTSTORE --> FACTORY
    FACTORY --> PARSER
    FACTORY --> ENVVALID
    FACTORY --> CANON
    FACTORY --> HMAC
    FACTORY --> SCHEMA
    FACTORY --> SEM
    FACTORY --> HASH
    FACTORY --> SERVICE
```

## File Intake Flow

```mermaid
flowchart TD
    ROOT["CollectorFileIntakeConfiguration.handoffRoot"]
    INIT["CollectorFileIntakeService.initialize()"]
    INCOMING["incoming/<collectorId>/"]
    PROCESSING["processing/"]
    QUARANTINE["quarantine/"]
    DISCOVER["claimPublishedBatches()"]
    RENAME["atomic rename into processing/"]
    CHECK["size + filename validation"]
    CLAIMED["ClaimedCollectorBatchFile"]
    QUAR["QuarantinedCollectorBatchFile"]
    IGNORE["IgnoredCollectorFile"]

    ROOT --> INIT --> INCOMING --> DISCOVER --> RENAME --> CHECK --> CLAIMED
    CHECK -->|empty or too large| QUAR
    DISCOVER -->|unexpected directory/file| IGNORE
    CLAIMED --> PROCESSING
    QUAR --> QUARANTINE
```

## Verification Flow

```mermaid
flowchart TD
    INPUT["Uint8Array collector payload"]
    SIZE["validateFileSize()"]
    PARSE["StrictJsonParser.parse()"]
    ENVELOPE["CollectorEnvelopeValidator.validate()"]
    TRUST["trustStore.resolveKey(collector_id, key_id)"]
    CANON["Rfc8785Canonicalizer.canonicalize(unsignedValue)"]
    HMAC["HmacSha256Verifier.verify(canonicalBytes, key, signature)"]
    SCHEMA["CollectorMessageSchemaValidator.validate(parsedValue)"]
    SEM["CollectorMessageSemanticValidator.validate(message)"]
    RETURN["VerifiedCollectorMessage"]
    FAIL["CollectorVerificationError"]

    INPUT --> SIZE --> PARSE --> ENVELOPE --> TRUST --> CANON --> HMAC --> SCHEMA --> SEM --> RETURN
    TRUST -->|unknown collector or unknown key| FAIL
    HMAC -->|digest mismatch| FAIL
    SCHEMA -->|schema invalid| FAIL
    SEM -->|semantic invalid| FAIL
```

## Runtime Sequence

```mermaid
sequenceDiagram
    participant Config
    participant Builder as createConfiguredCollectorMessageVerifier
    participant Trust as CollectorTrustStore
    participant Service as VerifyCollectorMessageService
    participant Parser as StrictJsonParser
    participant Envelope as CollectorEnvelopeValidator
    participant HMAC as HmacSha256Verifier
    participant Schema as CollectorMessageSchemaValidator
    participant Semantic as CollectorMessageSemanticValidator

    Config->>Builder: collectorId, keyId, secretBase64Url
    Builder->>Trust: resolve trust material
    Builder->>Service: inject parser, validators, canonicalizer, HMAC verifier, trustStore
    Service->>Parser: parse raw JSON
    Service->>Envelope: validate collector_id + integrity metadata
    Service->>Trust: resolveKey()
    Service->>HMAC: verify canonicalized bytes
    Service->>Schema: validate message schema
    Service->>Semantic: validate semantic constraints
    Service-->>Builder: VerifiedCollectorMessage
```

## Security Model

- Trust is based on a configured collector identity + key mapping, not on the message body itself.
- `removeIntegrityValue()` strips the `integrity.value` field before canonicalization to ensure the HMAC is calculated over the unsigned document.
- RFC 8785 canonicalization is applied before HMAC verification to avoid representation differences across JSON encoders.
- Verification fails early on malformed HMACs, unknown collectors, unknown key IDs, schema mismatches, or semantic violations.
- The file-intake service only claims, recovers, or quarantines files; it does not parse or verify collector content.

## Important Components

- [`application/verify-collector-message.service.ts`](./application/verify-collector-message.service.ts): orchestrates the full verification pipeline.
- [`composition/configured-ingestion-verification.dependencies.ts`](./composition/configured-ingestion-verification.dependencies.ts): builds a runtime trust store and verifier.
- [`composition/ingestion-verification.dependencies.ts`](./composition/ingestion-verification.dependencies.ts): instantiates parser, validators, canonicalizer, HMAC verifier, and service.
- [`infrastructure/collector-trust.configuration.ts`](./infrastructure/collector-trust.configuration.ts): creates trust-store configuration from runtime settings.
- [`infrastructure/collector-trust.store.ts`](./infrastructure/collector-trust.store.ts): resolves trusted collector IDs and signing keys.
- [`infrastructure/collector-file-intake.service.ts`](./infrastructure/collector-file-intake.service.ts): claims, recovers, and quarantines collector batch files on disk.
- [`infrastructure/hmac-sha256.verifier.ts`](./infrastructure/hmac-sha256.verifier.ts): confirms collector integrity.
- [`infrastructure/json/rfc8785-canonicalizer.ts`](./infrastructure/json/rfc8785-canonicalizer.ts): canonicalizes payloads before signing.
- [`contracts/collector-ingress/v1/ARCHITECTURE.md`](../../../../contracts/collector-ingress/v1/ARCHITECTURE.md): source of the versioned collector message contract.
