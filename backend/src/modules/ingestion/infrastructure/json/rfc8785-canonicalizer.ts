import type { JsonObject, JsonValue } from "../../domain/collector-contract.types.js";

import type { IJsonCanonicalizer } from "../../domain/collector-verification.contracts.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../../domain/collector-verification.errors.js";

export class Rfc8785Canonicalizer implements IJsonCanonicalizer {
    
    public canonicalize(value: JsonValue): Uint8Array {
        const canonicalJson = this.serializeValue(value);

        return new TextEncoder().encode(canonicalJson);
    }

    private serializeValue(value: JsonValue): string {
        if (value === null) {
            return "null";
        }

        if (typeof value === "string") {
            this.validateUnicode(value);
            return JSON.stringify(value);
        }

        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }

        if (typeof value === "number") {
            return this.serializeNumber(value);
        }

        if (isJsonArray(value)) {
            return `[${value.map((item) => this.serializeValue(item)).join(",")}]`;
        }

        return this.serializeObject(value);
    }

    private serializeObject(value: JsonObject): string {
        const keys = Object.keys(value).sort(compareUtf16CodeUnits);

        const properties = keys.map((key) => {
            this.validateUnicode(key);

            return `${JSON.stringify(key)}:${this.serializeValue(value[key])}`;
        });

        return `{${properties.join(",")}}`;
    }

    private serializeNumber(value: number): string {
        if (!Number.isFinite(value)) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_NUMBER,
                "parsing",
                "Canonical JSON cannot contain a non-finite number.",
            );
        }

        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNSAFE_INTEGER,
                "parsing",
                "Canonical JSON cannot contain an unsafe integer.",
            );
        }

        /*
         * JSON.stringify uses ECMAScript number serialization:
         *
         * -0        → 0
         * 1.5       → 1.5
         * 0.000001  → 0.000001
         * 1e+21     → 1e+21
         */
        const serialized = JSON.stringify(value);

        if (serialized === undefined) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_NUMBER,
                "parsing",
                "Number could not be canonically serialized.",
            );
        }

        return serialized;
    }

    private validateUnicode(value: string): void {
        for (let index = 0; index < value.length; index += 1) {
            const codeUnit = value.charCodeAt(index);

            if (isHighSurrogate(codeUnit)) {
                const nextCodeUnit = value.charCodeAt(index + 1);

                if (!isLowSurrogate(nextCodeUnit)) {
                    throw new CollectorVerificationError(
                        COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_UNICODE,
                        "parsing",
                        "Canonical JSON contains a lone high surrogate.",
                    );
                }

                index += 1;
                continue;
            }

            if (isLowSurrogate(codeUnit)) {
                throw new CollectorVerificationError(
                    COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_UNICODE,
                    "parsing",
                    "Canonical JSON contains a lone low surrogate.",
                );
            }
        }
    }
}

/*
 * RFC 8785 sorts object property names by unsigned UTF-16
 * code units. JavaScript's default string comparison is close,
 * but this comparator makes the rule explicit.
 */
function compareUtf16CodeUnits(left: string, right: string): number {
    const length = Math.min(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
        const difference = left.charCodeAt(index) - right.charCodeAt(index);

        if (difference !== 0) {
            return difference;
        }
    }

    return left.length - right.length;
}

function isHighSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
    return Array.isArray(value);
}
