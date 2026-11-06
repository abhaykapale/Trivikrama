# Ingestion strict JSON parser flow

This document shows how `StrictJsonParser` processes collector input and the main validation/error branches it can take.

```mermaid
flowchart TD
    A[StrictJsonParser.parse(input: Uint8Array)] --> B[rejectBom(input)]
    B -->|UTF-8 BOM present| E1[Throw CollectorVerificationError<br/>JSON_BOM_NOT_ALLOWED]
    B -->|No BOM| C[decodeUtf8(input)]

    C -->|Invalid UTF-8| E2[Throw CollectorVerificationError<br/>INVALID_UTF8]
    C -->|Valid UTF-8| D[Create JsonDocumentParser(document)]

    D --> F[parse()]
    F --> G[skipWhitespace()]
    G -->|Empty input| E3[Throw CollectorVerificationError<br/>INVALID_JSON: empty input]
    G --> H[parseValue(depth=0)]

    H --> I{Next token}
    I -->|{| J[parseObject(depth)]
    I -->|[| K[parseArray(depth)]
    I -->|"| L[parseString()]
    I -->|true| M[consumeKeyword("true")<br/>return true]
    I -->|false| N[consumeKeyword("false")<br/>return false]
    I -->|null| O[consumeKeyword("null")<br/>return null]
    I -->|digit or -| P[parseNumber()]
    I -->|other| E4[Throw CollectorVerificationError<br/>INVALID_JSON: expected valid JSON value]

    J --> J1[Read object members]
    J1 -->|Duplicate key| E5[Throw CollectorVerificationError<br/>DUPLICATE_JSON_KEY]
    J1 -->|Bad syntax| E6[Throw CollectorVerificationError<br/>INVALID_JSON]
    J1 -->|Valid| R1[Return null-prototype JsonObject]

    K --> K1[Read array elements]
    K1 -->|Bad syntax| E6
    K1 -->|Valid| R2[Return JsonValue[]]

    L --> L1[Handle escapes / Unicode]
    L1 -->|Control char / unterminated / invalid escape| E6
    L1 -->|Lone surrogate / bad surrogate pair| E7[Throw CollectorVerificationError<br/>INVALID_UNICODE]
    L1 -->|Valid| R3[Return string]

    P --> P1[Regex match JSON number]
    P1 -->|No match| E8[Throw CollectorVerificationError<br/>INVALID_NUMBER]
    P1 -->|Infinity/NaN| E8
    P1 -->|Unsafe integer| E9[Throw CollectorVerificationError<br/>UNSAFE_INTEGER]
    P1 -->|Valid| R4[Return number]

    R1 --> S[skipWhitespace()]
    R2 --> S
    R3 --> S
    R4 --> S
    M --> S
    N --> S
    O --> S

    S -->|Extra trailing content| E6
    S -->|End of input| T[Return parsed JsonValue]
```

## What this parser enforces

- Rejects UTF-8 BOM input.
- Rejects invalid UTF-8 bytes.
- Rejects duplicate object keys.
- Rejects unsafe integers that cannot be represented safely.
- Rejects invalid Unicode surrogate usage in strings.
- Rejects trailing non-whitespace content after a valid JSON document.

## Related files

- [Strict JSON parser implementation](../modules/ingestion/infrastructure/json/strict-json.parser.ts)
- [Collector JSON types](../modules/ingestion/domain/collector-contract.types.ts)
- [Collector verification contracts](../modules/ingestion/domain/collector-verification.contracts.ts)
