import type { MongoDbClient } from "../../../database/mongodb/client.js";
import type { NormalizedEventDocument } from "../../../database/repositories/mongodb/normalized-event.repository.js";
import type { DashboardEventMetrics, DashboardSourceRow, DashboardWindow, IDashboardEventRepository } from "../domain/dashboard.contracts.js";

interface SourceAggregationRow { readonly _id: unknown; readonly eventCount: number; }

export class MongoDashboardEventRepository implements IDashboardEventRepository {
  public constructor(private readonly client: MongoDbClient) {}

  public async getMetrics(orgId: string, window: DashboardWindow): Promise<DashboardEventMetrics> {
    const collection = this.collection();
    const [total, previousTotal] = await Promise.all([
      collection.countDocuments({ org_id: requireOrgId(orgId), time: { $gte: window.from, $lt: window.to } }),
      collection.countDocuments({ org_id: requireOrgId(orgId), time: { $gte: window.previousFrom, $lt: window.from } }),
    ]);
    return { total, previousTotal };
  }

  public async getSourceBreakdown(orgId: string, window: DashboardWindow): Promise<readonly DashboardSourceRow[]> {
    const rows = await this.collection().aggregate<SourceAggregationRow>([
      { $match: { org_id: requireOrgId(orgId), time: { $gte: window.from, $lt: window.to } } },
      { $group: {
        _id: { $ifNull: ["$metadata.product.source_type", { $ifNull: ["$unmapped.source_type", "$ingestion.collector_id"] }] },
        eventCount: { $sum: 1 },
      } },
      { $sort: { eventCount: -1, _id: 1 } },
      { $limit: 100 },
    ]).toArray();
    return rows.map((row) => ({ source: normalizeSource(row._id), eventCount: row.eventCount }));
  }

  private collection() {
    if (this.client.db === undefined) throw new Error("MongoDB client is not connected");
    return this.client.db.collection<NormalizedEventDocument>("normalized_events");
  }
}

function requireOrgId(orgId: string): string { const value = orgId.trim(); if (value.length === 0) throw new Error("orgId must not be blank"); return value; }
function normalizeSource(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim();
  return normalized.length === 0 ? "unknown" : normalized.slice(0, 200);
}
