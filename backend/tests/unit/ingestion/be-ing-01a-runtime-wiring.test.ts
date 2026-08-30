import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { createConfiguredCollectorMessageVerifier } from "../../../src/modules/ingestion/index.js";

const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v";

test("environment configuration creates a working Collector verifier", async () => {
    Object.assign(process.env, validEnvironment());

    const { loadEnvironmentConfig } = await import("../../../src/config/env.js");

    const config = loadEnvironmentConfig(validEnvironment());

    const verifier = createConfiguredCollectorMessageVerifier(config.collector.trust);

    const contractRoot = findContractRoot();

    const heartbeatBytes = readFileSync(
        join(contractRoot, "fixtures", "positive", "heartbeat.json"),
    );

    const result = await verifier.verify(heartbeatBytes);

    assert.equal(result.message.message_type, "heartbeat");

    assert.equal(result.message.collector_id, config.collector.trust.collectorId);

    assert.equal(result.message.integrity.key_id, config.collector.trust.keyId);
});

function validEnvironment(): NodeJS.ProcessEnv {
    return {
        NODE_ENV: "test",
        PORT: "3000",
        API_PREFIX: "/api/v1",

        JWT_SECRET: "v7Yp2Qm9Lx4Nc8Rt1Ks6Wd3Hj5Bf0Za7Pe2Uy9Mi4Go6Cq8Xs1Dv3Ln5Ak7Jr9Tw",

        JWT_ACCESS_TOKEN_EXPIRY: "1h",
        JWT_REFRESH_WINDOW: "5m",
        JWT_MAX_SESSION_DURATION: "7d",
        JWT_ISSUER: "ai-siem",
        JWT_COOKIE_NAME: "siem_token",
        JWT_COOKIE_SECURE: "false",

        BCRYPT_ROUNDS: "12",
        AUTH_LOCKOUT_ATTEMPTS: "5",
        AUTH_LOCKOUT_MINUTES: "15",
        AUTH_RATE_LIMIT_PER_MINUTE: "10",

        DATABASE_URL: "postgresql://app:test-password@localhost:5432/trivikrama_test",

        MONGODB_URI: "mongodb://localhost:27017/trivikrama_test",

        REDIS_URL: "redis://localhost:6379",

        COLLECTOR_DIR: "./collector",

        COLLECTOR_ID: "collector-dev-01",

        COLLECTOR_HMAC_KEY_ID: "collector-key-test-01",

        COLLECTOR_HMAC_SECRET: TEST_SECRET,

        FRONTEND_URL: "http://localhost:3001",

        LOG_LEVEL: "error",

        LOG_FORMAT: "json",
    };
}

function findContractRoot(): string {
    const candidates = [
        resolve(process.cwd(), "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
        resolve(process.cwd(), "..", "Trivikrama_ARCH-01", "contracts", "collector-ingress", "v1"),
    ];

    for (const candidate of candidates) {
        if (existsSync(join(candidate, "fixtures", "positive", "heartbeat.json"))) {
            return candidate;
        }
    }

    throw new Error("ARCH-01 contract fixtures were not found.");
}
