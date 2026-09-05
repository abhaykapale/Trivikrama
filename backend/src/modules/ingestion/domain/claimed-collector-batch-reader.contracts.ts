import type { ClaimedCollectorBatchFile } from "./collector-file-intake.contracts.js";

/**
 * Reads bytes only from a file that the intake service has already claimed.
 *
 * The application coordinator depends on this interface, not on node:fs.
 */
export interface IClaimedCollectorBatchReader {
    read(claimedFile: ClaimedCollectorBatchFile): Promise<Uint8Array>;
}
