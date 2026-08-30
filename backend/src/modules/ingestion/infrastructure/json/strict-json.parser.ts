import type { JsonObject, JsonValue } from "../../domain/collector-contract.types.js";

import type { IStrictJsonParser } from "../../domain/collector-verification.contracts.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../../domain/collector-verification.errors.js";

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const MAX_NESTING_DEPTH = 128;

export class StrictJsonParser implements IStrictJsonParser {
    public parse(input: Uint8Array): JsonValue {
        this.rejectBom(input);

        const document = this.decodeUtf8(input);
        const parser = new JsonDocumentParser(document);

        return parser.parse();
    }

    private rejectBom(input: Uint8Array): void {
        const hasBom =
            input.length >= UTF8_BOM.length &&
            input[0] === UTF8_BOM[0] &&
            input[1] === UTF8_BOM[1] &&
            input[2] === UTF8_BOM[2];

        if (hasBom) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.JSON_BOM_NOT_ALLOWED,
                "parsing",
                "Collector JSON must not contain a UTF-8 BOM.",
            );
        }
    }

    private decodeUtf8(input: Uint8Array): string {
        try {
            return new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
            }).decode(input);
        } catch {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_UTF8,
                "parsing",
                "Collector message is not valid UTF-8.",
            );
        }
    }
}

class JsonDocumentParser {
    private position = 0;

    public constructor(private readonly input: string) {}

    public parse(): JsonValue {
        this.skipWhitespace();

        if (this.isAtEnd()) {
            this.failInvalidJson("Collector message is empty.");
        }

        const value = this.parseValue(0);

        this.skipWhitespace();

        if (!this.isAtEnd()) {
            this.failInvalidJson("Unexpected content appears after the JSON document.");
        }

        return value;
    }

    private parseValue(depth: number): JsonValue {
        if (depth > MAX_NESTING_DEPTH) {
            this.failInvalidJson("Collector JSON exceeds the maximum nesting depth.");
        }

        const character = this.peek();

        switch (character) {
            case "{":
                return this.parseObject(depth);

            case "[":
                return this.parseArray(depth);

            case '"':
                return this.parseString();

            case "t":
                this.consumeKeyword("true");
                return true;

            case "f":
                this.consumeKeyword("false");
                return false;

            case "n":
                this.consumeKeyword("null");
                return null;

            default:
                if (character === "-" || this.isDigit(character)) {
                    return this.parseNumber();
                }

                this.failInvalidJson("Expected a valid JSON value.");
        }
    }

    private parseObject(depth: number): JsonObject {
        this.consume("{");
        this.skipWhitespace();

        /*
         * A null-prototype object prevents special property names such as
         * "__proto__" from modifying the object's prototype.
         */
        const result = Object.create(null) as Record<string, JsonValue>;
        const keys = new Set<string>();

        if (this.peek() === "}") {
            this.position += 1;
            return result;
        }

        while (true) {
            if (this.peek() !== '"') {
                this.failInvalidJson("Expected a quoted JSON object property name.");
            }

            const keyPosition = this.position;
            const key = this.parseString();

            if (keys.has(key)) {
                throw new CollectorVerificationError(
                    COLLECTOR_VERIFICATION_ERROR_CODES.DUPLICATE_JSON_KEY,
                    "parsing",
                    "Collector JSON contains a duplicate object property.",
                    {
                        characterOffset: keyPosition,
                    },
                );
            }

            keys.add(key);

            this.skipWhitespace();
            this.consume(":");
            this.skipWhitespace();

            result[key] = this.parseValue(depth + 1);

            this.skipWhitespace();

            const separator = this.peek();

            if (separator === "}") {
                this.position += 1;
                return result;
            }

            if (separator !== ",") {
                this.failInvalidJson("Expected ',' or '}' after a JSON object property.");
            }

            this.position += 1;
            this.skipWhitespace();
        }
    }

    private parseArray(depth: number): readonly JsonValue[] {
        this.consume("[");
        this.skipWhitespace();

        const result: JsonValue[] = [];

        if (this.peek() === "]") {
            this.position += 1;
            return result;
        }

        while (true) {
            result.push(this.parseValue(depth + 1));

            this.skipWhitespace();

            const separator = this.peek();

            if (separator === "]") {
                this.position += 1;
                return result;
            }

            if (separator !== ",") {
                this.failInvalidJson("Expected ',' or ']' after a JSON array value.");
            }

            this.position += 1;
            this.skipWhitespace();
        }
    }

    private parseString(): string {
        this.consume('"');

        let result = "";

        while (!this.isAtEnd()) {
            const character = this.peek();

            if (character === '"') {
                this.position += 1;
                return result;
            }

            if (character === "\\") {
                result += this.parseEscapeSequence();
                continue;
            }

            const codeUnit = character.charCodeAt(0);

            if (codeUnit <= 0x1f) {
                this.failInvalidJson("JSON strings must not contain unescaped control characters.");
            }

            if (this.isHighSurrogate(codeUnit)) {
                const nextCharacter = this.input[this.position + 1];
                const nextCodeUnit = nextCharacter?.charCodeAt(0);

                if (nextCodeUnit === undefined || !this.isLowSurrogate(nextCodeUnit)) {
                    this.failInvalidUnicode("JSON string contains a lone high surrogate.");
                }

                result += character + nextCharacter;
                this.position += 2;
                continue;
            }

            if (this.isLowSurrogate(codeUnit)) {
                this.failInvalidUnicode("JSON string contains a lone low surrogate.");
            }

            result += character;
            this.position += 1;
        }

        this.failInvalidJson("JSON string is not terminated.");
    }

    private parseEscapeSequence(): string {
        this.consume("\\");

        const escapedCharacter = this.peek();

        switch (escapedCharacter) {
            case '"':
                this.position += 1;
                return '"';

            case "\\":
                this.position += 1;
                return "\\";

            case "/":
                this.position += 1;
                return "/";

            case "b":
                this.position += 1;
                return "\b";

            case "f":
                this.position += 1;
                return "\f";

            case "n":
                this.position += 1;
                return "\n";

            case "r":
                this.position += 1;
                return "\r";

            case "t":
                this.position += 1;
                return "\t";

            case "u":
                this.position += 1;
                return this.parseUnicodeEscape();

            default:
                this.failInvalidJson("JSON string contains an invalid escape sequence.");
        }
    }

    private parseUnicodeEscape(): string {
        const firstCodeUnit = this.readHexCodeUnit();

        if (this.isLowSurrogate(firstCodeUnit)) {
            this.failInvalidUnicode("JSON string contains an escaped lone low surrogate.");
        }

        if (!this.isHighSurrogate(firstCodeUnit)) {
            return String.fromCharCode(firstCodeUnit);
        }

        if (this.peek() !== "\\" || this.input[this.position + 1] !== "u") {
            this.failInvalidUnicode("Escaped high surrogate is not followed by a low surrogate.");
        }

        this.position += 2;

        const secondCodeUnit = this.readHexCodeUnit();

        if (!this.isLowSurrogate(secondCodeUnit)) {
            this.failInvalidUnicode("Escaped high surrogate is not followed by a low surrogate.");
        }

        return String.fromCharCode(firstCodeUnit, secondCodeUnit);
    }

    private readHexCodeUnit(): number {
        const hex = this.input.slice(this.position, this.position + 4);

        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.failInvalidJson("JSON string contains an invalid Unicode escape.");
        }

        this.position += 4;

        return Number.parseInt(hex, 16);
    }

    private parseNumber(): number {
        const remainingInput = this.input.slice(this.position);

        const match = remainingInput.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);

        if (match === null) {
            this.failInvalidNumber("JSON contains an invalid number.");
        }

        const serializedNumber = match[0];
        const value = Number(serializedNumber);

        if (!Number.isFinite(value)) {
            this.failInvalidNumber("JSON number must have a finite IEEE-754 representation.");
        }

        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNSAFE_INTEGER,
                "parsing",
                "Collector JSON contains an unsafe integer value.",
                {
                    characterOffset: this.position,
                },
            );
        }

        this.position += serializedNumber.length;

        return value;
    }

    private consumeKeyword(keyword: string): void {
        if (!this.input.startsWith(keyword, this.position)) {
            this.failInvalidJson(`Expected JSON token '${keyword}'.`);
        }

        this.position += keyword.length;
    }

    private consume(expectedCharacter: string): void {
        if (this.peek() !== expectedCharacter) {
            this.failInvalidJson(`Expected '${expectedCharacter}' in JSON document.`);
        }

        this.position += 1;
    }

    private skipWhitespace(): void {
        while (!this.isAtEnd()) {
            const character = this.peek();

            if (
                character !== " " &&
                character !== "\t" &&
                character !== "\r" &&
                character !== "\n"
            ) {
                return;
            }

            this.position += 1;
        }
    }

    private peek(): string {
        return this.input[this.position] ?? "";
    }

    private isAtEnd(): boolean {
        return this.position >= this.input.length;
    }

    private isDigit(character: string): boolean {
        return character >= "0" && character <= "9";
    }

    private isHighSurrogate(codeUnit: number): boolean {
        return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    }

    private isLowSurrogate(codeUnit: number): boolean {
        return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
    }

    private failInvalidJson(message: string): never {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_JSON,
            "parsing",
            message,
            {
                characterOffset: this.position,
            },
        );
    }

    private failInvalidUnicode(message: string): never {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_UNICODE,
            "parsing",
            message,
            {
                characterOffset: this.position,
            },
        );
    }

    private failInvalidNumber(message: string): never {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.INVALID_NUMBER,
            "parsing",
            message,
            {
                characterOffset: this.position,
            },
        );
    }
}
