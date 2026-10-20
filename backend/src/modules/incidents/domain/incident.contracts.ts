export type IncidentStatus = "open" | "investigating" | "resolved" | "closed";

export type IncidentSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export type IncidentSource = "rule" | "ai" | "both";

/** Entity kinds currently emitted by OCSF mapping and operational detections. */
export type IncidentEntityType =
  | "user"
  | "user_id"
  | "host"
  | "src_host"
  | "src_ip"
  | "dst_ip"
  | "collector"
  | "source_type";

export interface IncidentEntity {
  readonly type: IncidentEntityType;
  readonly value: string;
}

export type IncidentKillChainStage =
  | "reconnaissance"
  | "resource_development"
  | "initial_access"
  | "execution"
  | "persistence"
  | "privilege_escalation"
  | "defense_evasion"
  | "credential_access"
  | "discovery"
  | "lateral_movement"
  | "collection"
  | "command_and_control"
  | "exfiltration"
  | "impact";

/** The scorer owns the factor-level structure and may evolve it independently. */
export type IncidentScoreBreakdown = Readonly<Record<string, unknown>>;

export interface IncidentCorrelationCandidateInput {
  readonly orgId: string;
  readonly entities: readonly IncidentEntity[];
  readonly activeAfter: Date;
  readonly limit?: number;
}

export interface IncidentCorrelationConfiguration {
  readonly timeWindowMinutes: number;
  readonly maxDurationHours: number;
  readonly entityTypes: readonly IncidentEntityType[];
  readonly candidateLimit: number;
}
