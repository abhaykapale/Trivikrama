import type { RealtimeConnection, RealtimeNotification } from "../domain/realtime.contracts.js";

const MAX_CONNECTIONS_PER_SESSION = 5;

export class TenantConnectionHub {
  private readonly byOrganization = new Map<string, Set<RealtimeConnection>>();
  private readonly bySession = new Map<string, Set<RealtimeConnection>>();

  public canAccept(sessionId: string): boolean {
    return (this.bySession.get(sessionId)?.size ?? 0) < MAX_CONNECTIONS_PER_SESSION;
  }

  public add(connection: RealtimeConnection): boolean {
    if (!this.canAccept(connection.principal.sessionId)) return false;
    addToMap(this.byOrganization, connection.principal.orgId, connection);
    addToMap(this.bySession, connection.principal.sessionId, connection);
    return true;
  }

  public remove(connection: RealtimeConnection): void {
    removeFromMap(this.byOrganization, connection.principal.orgId, connection);
    removeFromMap(this.bySession, connection.principal.sessionId, connection);
  }

  public broadcast(notification: RealtimeNotification): number {
    const connections = this.byOrganization.get(notification.orgId);
    if (connections === undefined) return 0;
    const message = { id: notification.id, type: notification.type, occurredAt: notification.occurredAt, data: notification.data };
    let delivered = 0;
    for (const connection of connections) {
      if (!connection.isOpen) continue;
      try { connection.send(message); delivered += 1; }
      catch { connection.close(1011, "Delivery failed"); }
    }
    return delivered;
  }

  public closeAll(code = 1001, reason = "Server shutting down"): void {
    const connections = new Set([...this.bySession.values()].flatMap((value) => [...value]));
    for (const connection of connections) connection.close(code, reason);
    this.byOrganization.clear();
    this.bySession.clear();
  }
}

function addToMap(map: Map<string, Set<RealtimeConnection>>, key: string, value: RealtimeConnection): void {
  const entries = map.get(key) ?? new Set<RealtimeConnection>(); entries.add(value); map.set(key, entries);
}
function removeFromMap(map: Map<string, Set<RealtimeConnection>>, key: string, value: RealtimeConnection): void {
  const entries = map.get(key); if (entries === undefined) return; entries.delete(value); if (entries.size === 0) map.delete(key);
}
