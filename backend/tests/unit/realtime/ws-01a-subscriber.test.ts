import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { RedisClient } from "../../../src/database/redis/client.js";
import { TenantConnectionHub } from "../../../src/modules/realtime/application/tenant-connection-hub.js";
import type { RealtimeConnection, RealtimePrincipal } from "../../../src/modules/realtime/domain/realtime.contracts.js";
import { parseNotification, RedisRealtimeSubscriber } from "../../../src/modules/realtime/infrastructure/redis-realtime.subscriber.js";

test("WS-01A accepts bounded incident outbox payloads", () => {
  const value = { id: "notification-1", type: "INCIDENT_STATUS_CHANGED", occurredAt: "2026-10-28T12:00:00.000Z", orgId: "tenant-a", data: { incidentId: "incident-1", status: "resolved" } };
  assert.deepEqual(parseNotification(JSON.stringify(value)), value);
});

test("WS-01A rejects malformed, unknown, array-data, and oversized Redis messages", () => {
  assert.equal(parseNotification("not-json"), null);
  assert.equal(parseNotification(JSON.stringify({ id: "x", type: "UNKNOWN", occurredAt: new Date().toISOString(), orgId: "tenant-a", data: {} })), null);
  assert.equal(parseNotification(JSON.stringify({ id: "x", type: "INCIDENT_CREATED", occurredAt: "invalid", orgId: "tenant-a", data: [] })), null);
  assert.equal(parseNotification("x".repeat(65_537)), null);
});

test("WS-01A subscribes only to allowlisted channels and routes by payload tenant", async () => {
  const redis = new FakeRedisSubscriber(); const hub = new TenantConnectionHub();
  const tenantA = memoryConnection("tenant-a"); const tenantB = memoryConnection("tenant-b");
  hub.add(tenantA); hub.add(tenantB);
  const subscriber = new RedisRealtimeSubscriber(redis as unknown as RedisClient, hub);
  await subscriber.start();
  assert.deepEqual(redis.subscribed, ["incidents:new", "incidents:updated", "incidents:status"]);
  redis.emit("message", "incidents:new", JSON.stringify({ id: "n-1", type: "INCIDENT_CREATED", occurredAt: "2026-10-28T12:00:00.000Z", orgId: "tenant-a", data: { incidentId: "i-1" } }));
  assert.equal(tenantA.messages.length, 1); assert.equal(tenantB.messages.length, 0);
  await subscriber.close();
  assert.deepEqual(redis.unsubscribed, redis.subscribed); assert.equal(redis.quitCalled, true);
});

class FakeRedisSubscriber extends EventEmitter {
  public status = "ready"; public subscribed: string[] = []; public unsubscribed: string[] = []; public quitCalled = false;
  public duplicate() { return this; }
  public async subscribe(...channels: string[]) { this.subscribed = channels; return channels.length; }
  public async unsubscribe(...channels: string[]) { this.unsubscribed = channels; return channels.length; }
  public async quit() { this.quitCalled = true; this.status = "end"; return "OK"; }
  public disconnect() { this.status = "end"; }
}
interface MemoryConnection extends RealtimeConnection { readonly messages: Array<Readonly<Record<string, unknown>>>; }
function memoryConnection(orgId: string): MemoryConnection {
  const principal: RealtimePrincipal = { userId: `user-${orgId}`, username: "analyst", role: "soc_analyst", orgId, sessionId: `session-${orgId}`, jwtId: `jwt-${orgId}`, expiresAt: new Date("2099-01-01") };
  return { id: `connection-${orgId}`, principal, isOpen: true, messages: [], send(value) { this.messages.push(value); }, close() {} };
}
