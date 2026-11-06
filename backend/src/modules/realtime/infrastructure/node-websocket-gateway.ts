import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { RealtimeConnection, RealtimePrincipal } from "../domain/realtime.contracts.js";
import { REALTIME_PATH } from "../domain/realtime.contracts.js";
import type { WebSocketUpgradeAuthenticator } from "../application/websocket-upgrade-authenticator.js";
import type { TenantConnectionHub } from "../application/tenant-connection-hub.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CLIENT_MESSAGE_BYTES = 16_384;
const MAX_BUFFER_BYTES = MAX_CLIENT_MESSAGE_BYTES + 32;
const HEARTBEAT_INTERVAL_MS = 30_000;

export class NodeWebSocketGateway {
  private server: Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private heartbeatCheckRunning = false;
  private readonly connections = new Set<NodeRealtimeConnection>();
  private readonly onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    void this.handleUpgrade(request, socket, head);
  };

  public constructor(
    private readonly authenticator: WebSocketUpgradeAuthenticator,
    private readonly hub: TenantConnectionHub,
  ) {}

  public attach(server: Server): void {
    if (this.server !== null) throw new Error("WebSocket gateway is already attached.");
    this.server = server;
    server.on("upgrade", this.onUpgrade);
    this.heartbeat = setInterval(() => { void this.checkHeartbeats(); }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  public async close(): Promise<void> {
    if (this.server !== null) this.server.off("upgrade", this.onUpgrade);
    this.server = null;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.hub.closeAll();
    this.connections.clear();
  }

  private async handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    socket.on("error", () => socket.destroy());
    if (!isWebSocketRequest(request)) { rejectUpgrade(socket, 426, "WebSocket upgrade required."); return; }
    const result = await this.authenticator.authenticate({ headers: request.headers, url: request.url });
    if (!result.ok) { rejectUpgrade(socket, result.status, result.message); return; }
    if (!this.hub.canAccept(result.principal.sessionId)) { rejectUpgrade(socket, 429, "Connection limit exceeded."); return; }
    const key = request.headers["sec-websocket-key"]!;
    const connection = new NodeRealtimeConnection(socket, result.principal, () => {
      this.hub.remove(connection); this.connections.delete(connection);
    });
    if (!this.hub.add(connection)) { rejectUpgrade(socket, 429, "Connection limit exceeded."); return; }
    this.connections.add(connection);
    socket.write([
      "HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64")}`, "", "",
    ].join("\r\n"));
    connection.activate(head);
  }

  private async checkHeartbeats(): Promise<void> {
    if (this.heartbeatCheckRunning) return;
    this.heartbeatCheckRunning = true;
    try {
      await Promise.all([...this.connections].map(async (connection) => {
        if (!connection.heartbeatObserved) { connection.close(1001, "Heartbeat timeout"); return; }
        if (!await this.authenticator.isStillAuthorized(connection.principal)) { connection.close(1008, "Session no longer authorized"); return; }
        connection.requestHeartbeat();
      }));
    } finally { this.heartbeatCheckRunning = false; }
  }
}

class NodeRealtimeConnection implements RealtimeConnection {
  public readonly id = randomUUID();
  public isOpen = true;
  public heartbeatObserved = true;
  private buffer = Buffer.alloc(0);
  private readonly bucket = new TokenBucket(100, 100 / 60_000);
  private readonly expiryTimer: NodeJS.Timeout;
  private activated = false;

  public constructor(
    private readonly socket: Socket,
    public readonly principal: RealtimePrincipal,
    private readonly onClosed: () => void,
  ) {
    const delay = Math.max(1, Math.min(principal.expiresAt.getTime() - Date.now(), 2_147_483_647));
    this.expiryTimer = setTimeout(() => this.close(1008, "Session expired"), delay);
    this.expiryTimer.unref();
  }

  public activate(head: Buffer): void {
    if (this.activated) return;
    this.activated = true;
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk));
    this.socket.once("close", () => this.finish());
    this.socket.once("end", () => this.finish());
    if (head.length > 0) this.receive(head);
  }

  public send(value: Readonly<Record<string, unknown>>): void {
    if (!this.isOpen) return;
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    if (payload.length > 65_536) { this.close(1009, "Message too large"); return; }
    this.socket.write(encodeFrame(0x1, payload));
  }

  public requestHeartbeat(): void {
    if (!this.isOpen) return;
    this.heartbeatObserved = false;
    this.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
  }

  public close(code: number, reason: string): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 123);
    const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
    payload.writeUInt16BE(code); reasonBytes.copy(payload, 2);
    this.socket.end(encodeFrame(0x8, payload));
    this.finish();
  }

  private receive(chunk: Buffer): void {
    if (!this.isOpen) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFER_BYTES) { this.close(1009, "Message too large"); return; }
    while (this.consumeFrame()) { /* consume all complete frames */ }
  }

  private consumeFrame(): boolean {
    if (this.buffer.length < 2 || !this.isOpen) return false;
    const first = this.buffer[0]!; const second = this.buffer[1]!;
    const final = (first & 0x80) !== 0; const rsv = first & 0x70; const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if (rsv !== 0 || !masked) { this.close(1002, "Protocol error"); return false; }
    let length = second & 0x7f; let offset = 2;
    if (length === 126) { if (this.buffer.length < 4) return false; length = this.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) {
      if (this.buffer.length < 10) return false;
      const large = this.buffer.readBigUInt64BE(2);
      if (large > BigInt(MAX_CLIENT_MESSAGE_BYTES)) { this.close(1009, "Message too large"); return false; }
      length = Number(large); offset = 10;
    }
    if (length > MAX_CLIENT_MESSAGE_BYTES) { this.close(1009, "Message too large"); return false; }
    const control = opcode >= 0x8;
    if ((control && (!final || length > 125)) || (!control && !final)) { this.close(1002, "Fragmentation not supported"); return false; }
    if (this.buffer.length < offset + 4 + length) return false;
    const mask = this.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]!;
    this.buffer = this.buffer.subarray(offset + length);
    if (!this.bucket.consume()) { this.close(1008, "Frame rate exceeded"); return false; }
    this.handleFrame(opcode, payload);
    return this.isOpen && this.buffer.length > 0;
  }

  private handleFrame(opcode: number, payload: Buffer): void {
    if (opcode === 0x8) { this.close(1000, "Closed"); return; }
    if (opcode === 0x9) { this.socket.write(encodeFrame(0xA, payload)); return; }
    if (opcode === 0xA) { this.heartbeatObserved = true; return; }
    if (opcode !== 0x1) { this.close(1003, "Unsupported frame"); return; }
    try {
      const value: unknown = JSON.parse(payload.toString("utf8"));
      if (typeof value === "object" && value !== null && "type" in value && value.type === "ping") {
        this.send({ type: "pong", occurredAt: new Date().toISOString() }); return;
      }
    } catch { /* fall through */ }
    this.close(1008, "Unsupported client message");
  }

  private finish(): void {
    if (this.activated || this.isOpen) {
      this.isOpen = false; clearTimeout(this.expiryTimer); this.onClosed();
    }
    this.activated = false;
  }
}

class TokenBucket {
  private tokens: number;
  private updatedAt = Date.now();
  public constructor(private readonly capacity: number, private readonly refillPerMs: number) { this.tokens = capacity; }
  public consume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) * this.refillPerMs);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1; return true;
  }
}

function isWebSocketRequest(request: IncomingMessage): boolean {
  let url: URL;
  try { url = new URL(request.url ?? "", "http://localhost"); } catch { return false; }
  const key = request.headers["sec-websocket-key"];
  return url.pathname === REALTIME_PATH && url.search.length === 0 && request.method === "GET" &&
    request.headers.upgrade?.toLowerCase() === "websocket" &&
    request.headers.connection?.toLowerCase().split(",").map((part) => part.trim()).includes("upgrade") === true &&
    request.headers["sec-websocket-version"] === "13" && typeof key === "string" && isValidWebSocketKey(key);
}

function isValidWebSocketKey(value: string): boolean {
  try { return Buffer.from(value, "base64").length === 16 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value); }
  catch { return false; }
}

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error: { code: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 429 ? "CONNECTION_LIMIT" : "UPGRADE_REQUIRED", message } });
  const version = status === 426 ? "Sec-WebSocket-Version: 13\r\n" : "";
  socket.end(`HTTP/1.1 ${status} ${statusText(status)}\r\n${version}Connection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function statusText(status: number): string {
  return status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Upgrade Required";
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const headerLength = payload.length < 126 ? 2 : payload.length <= 65_535 ? 4 : 10;
  const frame = Buffer.allocUnsafe(headerLength + payload.length);
  frame[0] = 0x80 | opcode;
  if (payload.length < 126) frame[1] = payload.length;
  else if (payload.length <= 65_535) { frame[1] = 126; frame.writeUInt16BE(payload.length, 2); }
  else { frame[1] = 127; frame.writeBigUInt64BE(BigInt(payload.length), 2); }
  payload.copy(frame, headerLength); return frame;
}
