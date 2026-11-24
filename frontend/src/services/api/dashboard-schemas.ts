import { z } from "zod";

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();
const isoDateTime = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid ISO date-time.");

const severityDistributionSchema = z.object({
  critical: nonNegativeInteger,
  high: nonNegativeInteger,
  medium: nonNegativeInteger,
  low: nonNegativeInteger,
  informational: nonNegativeInteger,
});

export const dashboardSummarySchema = z.object({
  timeRange: z.string().min(1),
  incidents: z.object({
    open: nonNegativeInteger,
    openTrend: finiteNumber,
    critical: nonNegativeInteger,
    criticalTrend: finiteNumber,
    investigating: nonNegativeInteger,
    resolvedToday: nonNegativeInteger,
    closedToday: nonNegativeInteger,
  }),
  alerts: z.object({
    totalToday: nonNegativeInteger,
    alertsTrend: finiteNumber,
    ruleAlerts: nonNegativeInteger,
    aiAlerts: nonNegativeInteger,
  }),
  events: z.object({
    eventsPerSecond: nonNegativeNumber,
    epsTrend: finiteNumber,
    totalToday: nonNegativeInteger,
  }),
  responseTime: z.object({
    avgMinutes: nonNegativeNumber,
    avgTrend: finiteNumber,
    medianMinutes: nonNegativeNumber,
  }),
  severityDistribution: severityDistributionSchema,
  aiEngine: z.object({
    status: z.enum(["online", "degraded", "offline"]),
    modelVersion: z.string().nullable(),
    anomaliesDetected: nonNegativeInteger,
  }),
});

export const dashboardTimelineSchema = z.object({
  timeRange: z.string().min(1),
  interval: z.string().min(1),
  buckets: z.array(z.object({
    timestamp: isoDateTime,
    critical: nonNegativeInteger,
    high: nonNegativeInteger,
    medium: nonNegativeInteger,
    low: nonNegativeInteger,
    informational: nonNegativeInteger,
    total: nonNegativeInteger,
  })),
});

export const dashboardTopAssetsSchema = z.object({
  assets: z.array(z.object({
    entity: z.string().min(1),
    entityType: z.string().min(1),
    incidentCount: nonNegativeInteger,
    criticalCount: nonNegativeInteger,
    highCount: nonNegativeInteger,
    latestIncidentAt: isoDateTime,
  })),
});

export const dashboardSourceBreakdownSchema = z.object({
  sources: z.array(z.object({
    source: z.string().min(1),
    eventCount: nonNegativeInteger,
    percentage: nonNegativeNumber.max(100),
  })),
  total: nonNegativeInteger,
});

export { incidentQueuePageSchema as recentIncidentPageSchema } from "./incident-schemas";
