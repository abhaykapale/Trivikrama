import { createHash } from "node:crypto";

import type { CreateNormalizedEventInput } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type {
    CollectorEvent,
    CollectorEventBatch,
} from "../domain/collector-contract.types.js";
import type {
    ICollectorEventNormalizer,
    NormalizedCollectorBatch,
} from "../domain/collector-event-normalization.contracts.js";

/**
 * Projects the Collector's verified baseline OCSF representation into the
 * MongoDB read model. This class does not repair untrusted input: schema and
 * semantic verification must have completed before it is called.
 */
export class OcsfCollectorEventNormalizer implements ICollectorEventNormalizer {
    private readonly organizationId: string;

    public constructor(organizationId = "default") {
        const normalized = organizationId.trim();
        if (normalized.length === 0 || normalized.length > 100) {
            throw new Error("Collector organization ID must contain 1 to 100 characters");
        }
        this.organizationId = normalized;
    }

    public normalize(batch: CollectorEventBatch, ingestedAt: Date): NormalizedCollectorBatch {
        assertValidIngestionTime(ingestedAt);

        const events = batch.events.map((event) =>
            this.normalizeEvent(event, batch.batch_id, batch.collector_id, ingestedAt),
        );

        return {
            events: Object.freeze(events),
            stats: {
                totalEvents: events.length,
                schemaValid: events.length,
                schemaInvalid: 0,
            },
        };
    }

    private normalizeEvent(
        event: CollectorEvent,
        batchId: string,
        collectorId: string,
        ingestedAt: Date,
    ): CreateNormalizedEventInput {
        const ocsf = event.ocsf;
        const time = new Date(ocsf.time);

        if (!Number.isFinite(time.getTime())) {
            throw new Error(`Verified Collector event ${event.event_id} has an invalid OCSF time`);
        }

        return {
            event_id: event.event_id,
            dedup_hash: createDedupHash(event),
            class_uid: ocsf.class_uid,
            category_uid: ocsf.category_uid,
            severity_id: ocsf.severity_id,
            time,
            message: ocsf.message,
            src_endpoint: {
                ip: ocsf.src_endpoint.ip,
            },
            dst_endpoint: {
                hostname: ocsf.dst_endpoint.hostname,
            },
            actor: {
                user: {
                    name: ocsf.user.name,
                },
            },
            device: {
                hostname: event.source.original_endpoint_id,
            },
            metadata: {
                version: ocsf.metadata.version,
                product: { ...ocsf.metadata.product },
            },
            unmapped: structuredClone(ocsf.unmapped) as Record<string, unknown>,
            schema_valid: true,
            validation_errors: [],
            ingestion: {
                batch_id: batchId,
                collector_id: collectorId,
                ingested_at: new Date(ingestedAt),
            },
            raw_event: structuredClone(event) as unknown as Record<string, unknown>,
            org_id: this.organizationId,
        };
    }
}

/**
 * The dedup hash is deliberately non-unique. It detects similar event content;
 * only event_id is allowed to enforce replay idempotency.
 */
function createDedupHash(event: CollectorEvent): string {
    const ocsf = event.ocsf;
    const canonicalTuple = JSON.stringify([
        ocsf.class_uid,
        ocsf.category_uid,
        new Date(ocsf.time).toISOString(),
        ocsf.src_endpoint.ip,
        "",
        ocsf.message.slice(0, 256),
    ]);

    return `sha256:${createHash("sha256").update(canonicalTuple, "utf8").digest("hex")}`;
}

function assertValidIngestionTime(value: Date): void {
    if (!Number.isFinite(value.getTime())) {
        throw new Error("Collector event ingestion time must be a valid Date");
    }
}
