import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type { CollectorEventBatch } from "./collector-contract.types.js";

export interface CollectorEventNormalizationStats {
    readonly totalEvents: number;
    readonly schemaValid: number;
    readonly schemaInvalid: number;
}

export interface NormalizedCollectorBatch {
    readonly events: readonly CreateNormalizedEventInput[];
    readonly stats: CollectorEventNormalizationStats;
}

/**
 * Converts an already authenticated and semantically verified Collector batch
 * into the backend's normalized-event persistence model.
 */
export interface ICollectorEventNormalizer {
    normalize(batch: CollectorEventBatch, ingestedAt: Date): NormalizedCollectorBatch;
}

