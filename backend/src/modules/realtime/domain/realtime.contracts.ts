import type { IncomingHttpHeaders } from "node:http";
import type { AuthRole } from "../../auth/domain/index.js";

export const REALTIME_PATH = "/ws";
export const REALTIME_CHANNELS = ["incidents:new", "incidents:updated", "incidents:status"] as const;
export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];

export interface RealtimePrincipal {
  readonly userId: string;
  readonly username: string;
  readonly role: AuthRole;
  readonly orgId: string;
  readonly sessionId: string;
  readonly jwtId: string;
  readonly expiresAt: Date;
}

export interface WebSocketUpgradeRequest {
  readonly headers: IncomingHttpHeaders;
  readonly url?: string;
}

export interface RealtimeConnection {
  readonly id: string;
  readonly principal: RealtimePrincipal;
  readonly isOpen: boolean;
  send(value: Readonly<Record<string, unknown>>): void;
  close(code: number, reason: string): void;
}

export interface RealtimeNotification {
  readonly id: string;
  readonly type: "INCIDENT_CREATED" | "INCIDENT_UPDATED" | "INCIDENT_STATUS_CHANGED";
  readonly occurredAt: string;
  readonly orgId: string;
  readonly data: Readonly<Record<string, unknown>>;
}
