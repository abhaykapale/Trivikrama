import { z } from "zod";

export type RealtimeConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

const notificationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["INCIDENT_CREATED", "INCIDENT_UPDATED", "INCIDENT_STATUS_CHANGED"]),
  occurredAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  data: z.record(z.string(), z.unknown()),
});

export type IncidentNotification = z.infer<typeof notificationSchema>;
type NotificationListener = (notification: IncidentNotification) => void;
type StatusListener = (status: RealtimeConnectionStatus) => void;

class IncidentWebSocketClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<NotificationListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private status: RealtimeConnectionStatus = "disconnected";
  private stopped = true;

  public subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    this.ensureConnected();
    return () => {
      this.listeners.delete(listener);
      this.stopWhenUnused();
    };
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    this.ensureConnected();
    return () => {
      this.statusListeners.delete(listener);
      this.stopWhenUnused();
    };
  }

  private ensureConnected(): void {
    if (typeof window === "undefined" || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped || typeof window === "undefined") return;
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(resolveWebSocketUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.setStatus("connected");
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = parseIncidentNotification(JSON.parse(event.data) as unknown);
        if (parsed) for (const listener of this.listeners) listener(parsed);
      } catch {
        // Invalid server messages are ignored and never reach application state.
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) {
        this.setStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => socket.close());
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting");
    const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt - 1, 5));
    const jitter = Math.floor(Math.random() * Math.max(250, baseDelay * 0.25));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (document.visibilityState === "hidden") {
        this.scheduleReconnect();
        return;
      }
      this.connect();
    }, baseDelay + jitter);
  }

  private stopWhenUnused(): void {
    if (this.listeners.size > 0 || this.statusListeners.size > 0) return;
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.socket?.close(1000, "Dashboard unmounted");
    this.socket = null;
    this.setStatus("disconnected");
  }

  private setStatus(status: RealtimeConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export function parseIncidentNotification(value: unknown): IncidentNotification | null {
  const parsed = notificationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function resolveWebSocketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? "ws://localhost:3000/ws";
  if (!configured.startsWith("/")) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${configured}`;
}

export const incidentWebSocket = new IncidentWebSocketClient();
