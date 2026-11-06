import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { AppConfig } from "../../../src/config/index.js";
import { closeRedis, connectRedis, createRedisClient } from "../../../src/database/redis/client.js";
import type { IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { createRealtimeDependencies } from "../../../src/modules/realtime/composition/realtime.dependencies.js";

test("WS-01A delivers a real Redis incident publication through an authenticated WebSocket", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("WS-01A integration tests refuse to run in production.");
  const redis = createRedisClient({ url: process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379", keyPrefix: `ws-01a-${Date.now()}:` });
  let realtime: ReturnType<typeof createRealtimeDependencies> | null = null;
  let server: Server | null = null;
  let socket: Socket | null = null;
  context.after(async () => { socket?.destroy(); if (realtime !== null) await realtime.close(); if (server !== null) await close(server); await closeRedis(redis); });
  await connectRedis(redis);
  realtime = createRealtimeDependencies(redis, authentication());
  await realtime.start();
  server = createServer((_request, response) => response.end()); realtime.attach(server); await listen(server);
  socket = await openWebSocket(server);
  const notification = { id: "ws-01a-notification", type: "INCIDENT_CREATED", occurredAt: new Date().toISOString(), orgId: "tenant-a", data: { incidentId: "incident-1", severity: "high" } };
  const frame = readTextFrame(socket);
  await redis.publish("incidents:new", JSON.stringify(notification));
  const delivered = JSON.parse(await frame) as Record<string, unknown>;
  assert.equal(delivered.id, notification.id); assert.equal(delivered.type, notification.type);
  assert.deepEqual(delivered.data, notification.data); assert.equal("orgId" in delivered, false);
});

function authentication() {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const claims: JwtClaims = { sub: userId, username: "analyst", role: "soc_analyst", jti: "jwt-ws-01a", iat: 1, exp: 4_102_444_800, iss: "ai-siem" };
  const jwtService: IJwtService = { async sign() { return "valid"; }, async verify(token) { if (token !== "valid") throw new Error("invalid"); return claims; } };
  const session: SessionRecord = { id: "session-ws-01a", userId, jwtId: claims.jti, ipAddress: null, userAgent: null, expiresAt: new Date("2099-01-01"), createdAt: new Date(), revokedAt: null };
  const user: UserRecord = { id: userId, username: "analyst", email: "analyst@example.test", passwordHash: "x", role: "soc_analyst", displayName: null, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId: "tenant-a" };
  return { jwtService, sessionRepository: { async findByJwtId() { return session; } }, userRepository: { async findById() { return user; } }, config: { frontend: { url: "http://localhost:3001" }, jwt: { cookie: { name: "siem_token" } } } as unknown as AppConfig };
}
async function listen(server: Server): Promise<void> { await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); }
async function close(server: Server): Promise<void> { if (!server.listening) return; await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
async function openWebSocket(server: Server): Promise<Socket> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1"); let response = Buffer.alloc(0);
    socket.setTimeout(3_000, () => { socket.destroy(); reject(new Error("WebSocket upgrade timeout")); });
    socket.once("connect", () => socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: http://localhost:3001\r\nCookie: siem_token=valid\r\n\r\n`));
    const onData = (chunk: Buffer) => { response = Buffer.concat([response, chunk]); const boundary = response.indexOf("\r\n\r\n"); if (boundary < 0) return; socket.off("data", onData); socket.setTimeout(0); const headers = response.subarray(0, boundary).toString("latin1"); if (!headers.startsWith("HTTP/1.1 101")) { socket.destroy(); reject(new Error(headers)); return; } resolve(socket); };
    socket.on("data", onData); socket.once("error", reject);
  });
}
async function readTextFrame(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0); const timeout = setTimeout(() => { cleanup(); reject(new Error("WebSocket message timeout")); }, 3_000);
    const onData = (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length < 2) return; let length = buffer[1]! & 0x7f; let offset = 2; if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; } if (buffer.length < offset + length) return; cleanup(); resolve(buffer.subarray(offset, offset + length).toString("utf8")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timeout); socket.off("data", onData); socket.off("error", onError); };
    socket.on("data", onData); socket.on("error", onError);
  });
}
