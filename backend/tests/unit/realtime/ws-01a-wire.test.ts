import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { AppConfig } from "../../../src/config/index.js";
import type { IJwtService, JwtClaims } from "../../../src/modules/auth/domain/index.js";
import { TenantConnectionHub } from "../../../src/modules/realtime/application/tenant-connection-hub.js";
import { WebSocketUpgradeAuthenticator } from "../../../src/modules/realtime/application/websocket-upgrade-authenticator.js";
import { NodeWebSocketGateway } from "../../../src/modules/realtime/infrastructure/node-websocket-gateway.js";

test("WS-01A wire gateway rejects unauthenticated upgrades and accepts valid cookie upgrades", async () => {
  const server = createServer((_request, response) => response.end());
  const gateway = new NodeWebSocketGateway(authenticator(), new TenantConnectionHub());
  gateway.attach(server);
  await listen(server);
  try {
    const unauthorized = await upgrade(server, "Origin: http://localhost:3001\r\n");
    assert.match(unauthorized, /^HTTP\/1\.1 401 Unauthorized/u);
    const accepted = await upgrade(server, "Origin: http://localhost:3001\r\nCookie: siem_token=valid\r\n");
    assert.match(accepted, /^HTTP\/1\.1 101 Switching Protocols/u);
    assert.match(accepted, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/u);
  } finally { await gateway.close(); await close(server); }
});

test("WS-01A wire gateway rejects cross-origin and non-/ws upgrades", async () => {
  const server = createServer((_request, response) => response.end()); const gateway = new NodeWebSocketGateway(authenticator(), new TenantConnectionHub()); gateway.attach(server); await listen(server);
  try {
    assert.match(await upgrade(server, "Origin: https://evil.test\r\nCookie: siem_token=valid\r\n"), /^HTTP\/1\.1 403 Forbidden/u);
    assert.match(await upgrade(server, "Origin: http://localhost:3001\r\nCookie: siem_token=valid\r\n", "/other"), /^HTTP\/1\.1 426 Upgrade Required/u);
  } finally { await gateway.close(); await close(server); }
});

function authenticator(): WebSocketUpgradeAuthenticator {
  const claims: JwtClaims = { sub: "550e8400-e29b-41d4-a716-446655440001", username: "analyst", role: "soc_analyst", jti: "jwt-1", iat: 1, exp: 4_102_444_800, iss: "ai-siem" };
  const jwt: IJwtService = { async sign() { return "valid"; }, async verify(token) { if (token !== "valid") throw new Error("invalid"); return claims; } };
  return new WebSocketUpgradeAuthenticator({ jwtService: jwt, sessionRepository: { async findByJwtId() { return { id: "session-1", userId: claims.sub, jwtId: claims.jti, ipAddress: null, userAgent: null, expiresAt: new Date("2099-01-01T00:00:00Z"), createdAt: new Date(), revokedAt: null }; } }, userRepository: { async findById() { return { id: claims.sub, username: "analyst", email: "a@example.test", passwordHash: "x", role: "soc_analyst", displayName: null, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId: "tenant-a" }; } }, config: { frontend: { url: "http://localhost:3001" }, jwt: { cookie: { name: "siem_token" } } } as unknown as AppConfig });
}
async function listen(server: Server): Promise<void> { await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
async function upgrade(server: Server, extraHeaders: string, path = "/ws"): Promise<string> {
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1"); let response = "";
    socket.setTimeout(2_000);
    socket.once("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extraHeaders}\r\n`));
    socket.on("data", (chunk) => { response += chunk.toString("latin1"); if (response.includes("\r\n\r\n")) { socket.destroy(); resolve(response); } });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("upgrade timeout")); });
    socket.once("error", reject);
  });
}
