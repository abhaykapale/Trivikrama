import { createHmac, timingSafeEqual } from "node:crypto";

import type { IHmacSha256Verifier } from "../domain/collector-verification.contracts.js";

const CONTRACT_PREFIX = "TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n";

const EXPECTED_SIGNATURE_BYTES = 32;
const EXPECTED_BASE64URL_LENGTH = 43;

export class HmacSha256Verifier implements IHmacSha256Verifier {
    public verify(signingInput: Uint8Array, key: Uint8Array, submittedSignature: string): boolean {
        if (key.length === 0) {
            return false;
        }

        if (!isUnpaddedBase64UrlSignature(submittedSignature)) {
            return false;
        }

        const submittedMac = Buffer.from(submittedSignature, "base64url");

        if (submittedMac.length !== EXPECTED_SIGNATURE_BYTES) {
            return false;
        }

        const prefixBytes = new TextEncoder().encode(CONTRACT_PREFIX);

        const expectedMac = createHmac("sha256", Buffer.from(key))
            .update(prefixBytes)
            .update(Buffer.from(signingInput))
            .digest();

        /*
         * timingSafeEqual must only be called with equal-length
         * buffers. The length check above prevents an exception.
         */
        return timingSafeEqual(expectedMac, submittedMac);
    }
}

function isUnpaddedBase64UrlSignature(value: string): boolean {
    if (value.length !== EXPECTED_BASE64URL_LENGTH) {
        return false;
    }

    return /^[A-Za-z0-9_-]+$/.test(value);
}
