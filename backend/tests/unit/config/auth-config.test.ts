import assert from "node:assert/strict";

const VALID_SECRET =
  "v7Yp2Qm9Lx4Nc8Rt1Ks6Wd3Hj5Bf0Za7Pe2Uy9Mi4Go6Cq8Xs1Dv3Ln5Ak7Jr9Tw";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PORT: "3000",
    API_PREFIX: "/api/v1",
    JWT_SECRET: VALID_SECRET,
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
    COLLECTOR_HMAC_SECRET:
      "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw",
    FRONTEND_URL: "http://localhost:3001",
    LOG_LEVEL: "error",
    LOG_FORMAT: "json",
  };
}

async function main(): Promise<void> {
  Object.assign(process.env, validEnvironment());

  const { EnvironmentConfigurationError, loadEnvironmentConfig } =
    await import("../../../src/config/env.js");
  const { redactSensitiveData } =
    await import("../../../src/shared/logger/redaction.js");

  const expectConfigurationFailure = (
    environment: NodeJS.ProcessEnv,
    expectedMessage: string,
  ): void => {
    assert.throws(
      () => loadEnvironmentConfig(environment),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentConfigurationError);
        assert.match(error.message, new RegExp(expectedMessage, "u"));
        assert.doesNotMatch(error.message, new RegExp(VALID_SECRET, "u"));

        if (environment.JWT_SECRET !== undefined) {
          assert.equal(error.message.includes(environment.JWT_SECRET), false);
        }

        return true;
      },
    );
  };

  const missingSecret = validEnvironment();
  delete missingSecret.JWT_SECRET;
  expectConfigurationFailure(missingSecret, "JWT_SECRET");

  expectConfigurationFailure(
    {
      ...validEnvironment(),
      JWT_SECRET: "too-short",
    },
    "at least 64 characters",
  );

  expectConfigurationFailure(
    {
      ...validEnvironment(),
      JWT_SECRET:
        "CHANGE_ME_TO_A_RANDOM_SECRET_WITH_AT_LEAST_64_CHARACTERS_BEFORE_STARTING",
    },
    "placeholder",
  );

  expectConfigurationFailure(
    {
      ...validEnvironment(),
      JWT_ACCESS_TOKEN_EXPIRY: "one-hour",
    },
    "JWT_ACCESS_TOKEN_EXPIRY",
  );

  expectConfigurationFailure(
    {
      ...validEnvironment(),
      BCRYPT_ROUNDS: "9",
    },
    "BCRYPT_ROUNDS",
  );

  expectConfigurationFailure(
    {
      ...validEnvironment(),
      NODE_ENV: "production",
      JWT_COOKIE_SECURE: "false",
      FRONTEND_URL: "https://soc.example.com",
    },
    "JWT_COOKIE_SECURE",
  );

  const productionWithoutCorsOrigin: NodeJS.ProcessEnv = {
    ...validEnvironment(),
    NODE_ENV: "production",
    JWT_COOKIE_SECURE: "true",
  };
  delete productionWithoutCorsOrigin.FRONTEND_URL;
  expectConfigurationFailure(productionWithoutCorsOrigin, "FRONTEND_URL");

  const validProductionConfig = loadEnvironmentConfig({
    ...validEnvironment(),
    NODE_ENV: "production",
    JWT_COOKIE_SECURE: "true",
    FRONTEND_URL: "https://soc.example.com",
  });
  assert.equal(validProductionConfig.jwt.cookie.secure, true);
  assert.equal(validProductionConfig.frontend.url, "https://soc.example.com");

  const validConfig = loadEnvironmentConfig(validEnvironment());
  assert.equal(validConfig.jwt.algorithm, "HS256");
  assert.equal(validConfig.jwt.accessTokenExpiry, "1h");
  assert.equal(validConfig.jwt.refreshWindow, "5m");
  assert.equal(validConfig.jwt.maxSessionDuration, "7d");
  assert.equal(validConfig.jwt.issuer, "ai-siem");
  assert.equal(validConfig.jwt.cookie.name, "siem_token");
  assert.equal(validConfig.auth.bcryptRounds, 12);
  assert.equal(validConfig.security.bcryptSaltRounds, 12);
  assert.equal(validConfig.auth.lockoutAttempts, 5);
  assert.equal(validConfig.auth.lockoutMinutes, 15);
  assert.equal(validConfig.auth.rateLimitPerMinute, 10);

  const redacted = redactSensitiveData({
    jwtSecret: VALID_SECRET,
    password: "test-password",
    databaseUrl:
      "postgresql://app:test-password@localhost:5432/trivikrama_test",
    nested: {
      authorization: "Bearer test-token",
      safe: "visible",
    },
  });

  assert.equal(redacted.jwtSecret, "[REDACTED]");
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.databaseUrl, "[REDACTED]");
  assert.equal(redacted.nested.authorization, "[REDACTED]");
  assert.equal(redacted.nested.safe, "visible");

  const redactedError = redactSensitiveData(
    new Error(
      "connection failed: postgresql://app:p@ssword@localhost:5432/trivikrama",
    ),
  );
  assert.doesNotMatch(redactedError.message, /p@ssword/u);
  assert.match(redactedError.message, /\[REDACTED\]/u);

  const redactedJwt = redactSensitiveData(
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue",
  );
  assert.equal(redactedJwt.includes("eyJhbGci"), false);

  console.log(
    JSON.stringify(
      {
        success: true,
        suite: "BE-01A auth configuration foundation",
        tests: 11,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        suite: "BE-01A auth configuration foundation",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
