import { createHash } from "node:crypto";

import type { ISha256Hasher, Sha256Digest } from "../domain/collector-verification.contracts.js";

export class Sha256Hasher implements ISha256Hasher {
    public digest(input: Uint8Array): Sha256Digest {
        const hexadecimalDigest = createHash("sha256").update(Buffer.from(input)).digest("hex");

        return `sha256:${hexadecimalDigest}`;
    }
}
