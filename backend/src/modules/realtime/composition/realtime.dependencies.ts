import type { Server } from "node:http";
import type { RedisClient } from "../../../database/redis/client.js";
import type { WebSocketUpgradeAuthenticatorDependencies } from "../application/websocket-upgrade-authenticator.js";
import { WebSocketUpgradeAuthenticator } from "../application/websocket-upgrade-authenticator.js";
import { TenantConnectionHub } from "../application/tenant-connection-hub.js";
import { NodeWebSocketGateway } from "../infrastructure/node-websocket-gateway.js";
import { RedisRealtimeSubscriber } from "../infrastructure/redis-realtime.subscriber.js";

export interface RealtimeDependencies {
  start(): Promise<void>;
  attach(server: Server): void;
  close(): Promise<void>;
}

export function createRealtimeDependencies(
  redis: RedisClient,
  authentication: WebSocketUpgradeAuthenticatorDependencies,
): RealtimeDependencies {
  const hub = new TenantConnectionHub();
  const gateway = new NodeWebSocketGateway(new WebSocketUpgradeAuthenticator(authentication), hub);
  const subscriber = new RedisRealtimeSubscriber(redis, hub);
  return {
    start: () => subscriber.start(),
    attach: (server) => gateway.attach(server),
    close: async () => { await gateway.close(); await subscriber.close(); },
  };
}
