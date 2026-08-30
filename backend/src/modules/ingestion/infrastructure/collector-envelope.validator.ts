import type {
    CollectorEnvelope,
    CollectorIntegrity,
    CollectorMessageType,
    JsonObject,
    JsonValue,
} from "../domain/collector-contract.types.js";

import type { ICollectorEnvelopeValidator } from "../domain/collector-verification.contracts.js";

import {
    COLLECTOR_VERIFICATION_ERROR_CODES,
    CollectorVerificationError,
} from "../domain/collector-verification.errors.js";

const SUPPORTED_CONTRACT_VERSION = "1.0.0";
const SUPPORTED_ALGORITHM = "HMAC-SHA256";

const SUPPORTED_MESSAGE_TYPES = new Set<CollectorMessageType>([
    "event_batch",
    "heartbeat",
    "rejected_event",
]);

export class CollectorEnvelopeValidator implements ICollectorEnvelopeValidator {
    public validate(value: JsonValue): CollectorEnvelope {
        if (!isJsonObject(value)) {
            this.failSchema("Collector message must be a JSON object.");
        }

        const contractVersion = this.requiredString(value, "contract_version");

        if (contractVersion !== SUPPORTED_CONTRACT_VERSION) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNSUPPORTED_CONTRACT_VERSION,
                "schema",
                "Collector contract version is not supported.",
            );
        }

        const messageType = this.requiredString(value, "message_type");

        if (!isSupportedMessageType(messageType)) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNSUPPORTED_MESSAGE_TYPE,
                "schema",
                "Collector message type is not supported.",
            );
        }

        const collectorId = this.requiredString(value, "collector_id");

        const integrityValue = value.integrity;

        if (!isJsonObject(integrityValue)) {
            this.failSchema("Collector message must contain an integrity object.");
        }

        const algorithm = this.requiredString(integrityValue, "algorithm");

        if (algorithm !== SUPPORTED_ALGORITHM) {
            throw new CollectorVerificationError(
                COLLECTOR_VERIFICATION_ERROR_CODES.UNSUPPORTED_INTEGRITY_ALGORITHM,
                "integrity",
                "Collector integrity algorithm is not supported.",
            );
        }

        const keyId = this.requiredString(integrityValue, "key_id");

        const signature = this.requiredString(integrityValue, "value");

        const integrity: CollectorIntegrity = {
            algorithm: "HMAC-SHA256",
            key_id: keyId,
            value: signature,
        };

        return {
            contract_version: "1.0.0",
            message_type: messageType,
            collector_id: collectorId,
            integrity,
        };
    }

    private requiredString(object: JsonObject, propertyName: string): string {

        if (!hasOwnProperty(object, propertyName)) {
            this.failSchema(`Collector message is missing '${propertyName}'.`);
        }

        const value = object[propertyName];

        if (typeof value !== "string" || value.length === 0) {
            this.failSchema(`Collector property '${propertyName}' must be a non-empty string.`);
        }

        return value;
    }

    private failSchema(message: string): never {
        throw new CollectorVerificationError(
            COLLECTOR_VERIFICATION_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
            "schema",
            message,
        );
    }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty(object: JsonObject, propertyName: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, propertyName);
}

function isSupportedMessageType(value: string): value is CollectorMessageType {
    return SUPPORTED_MESSAGE_TYPES.has(value as CollectorMessageType);
}
