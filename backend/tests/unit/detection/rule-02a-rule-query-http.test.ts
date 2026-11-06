import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import type { GetRuleDetailQuery, ListRulesQuery, RuleDetailView } from "../../../src/modules/detection/domain/rule-query.contracts.js";
import type { ArchiveRuleCommand, ChangeRuleStatusCommand, CreateRuleCommand, ImportRulesCommand, UpdateRuleCommand } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import {
  CannotDeleteBuiltinRuleError,
  CannotModifyBuiltinRuleError,
  DuplicateSigmaRuleError,
  RuleCommandNotFoundError,
  RuleIdentityImmutableError,
  RuleStatusConflictError,
} from "../../../src/modules/detection/domain/rule-command.contracts.js";
import type { ExportRulesInput, RuleDryRunInput } from "../../../src/modules/detection/domain/rule-operational.contracts.js";
import { RuleValidationError } from "../../../src/modules/detection/domain/rule-validation.error.js";
import { createRuleQueryRouter } from "../../../src/modules/detection/http/rule-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const RULE_ID = "00000000-0000-4000-8000-000000000101";

test("RULE-02A endpoints require authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/rules`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/rules/${RULE_ID}`)).status, 401);
  });
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`RULE-02A permits authenticated ${role} and uses the trusted tenant`, async () => {
    const harness = createHarness();
    harness.addToken(`${role}-token`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const response = await requestJson(
        baseUrl,
        "/api/v1/rules?status=active&type=count&severity=high&search=ssh&tag=attack.t1110&isBuiltin=true&page=2&limit=10&sort=severity&order=desc&orgId=forged",
        `${role}-token`,
      );
      assert.equal(response.status, 200);
    });
    assert.deepEqual(harness.listInputs[0], {
      orgId: `org-${role}`,
      status: "active",
      type: "count",
      severity: "high",
      search: "ssh",
      tag: "attack.t1110",
      isBuiltin: true,
      page: 2,
      limit: 10,
      sort: "severity",
      order: "desc",
    });
  });
}

test("RULE-02A rejects malformed filters and identifiers before use-case execution", async () => {
  const harness = createHarness();
  harness.addToken("reader", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    for (const query of ["limit=101", "page=0", "isBuiltin=1", "sort=name%3Bdrop", "search="]) {
      const response = await requestJson(baseUrl, `/api/v1/rules?${query}`, "reader");
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
    assert.equal((await requestJson(baseUrl, "/api/v1/rules/not-a-uuid", "reader")).status, 400);
  });
  assert.equal(harness.listInputs.length, 0);
  assert.equal(harness.detailInputs.length, 0);
});

test("RULE-02A detail conceals absent or cross-tenant rules with 404", async () => {
  const harness = createHarness();
  harness.addToken("reader", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(baseUrl, `/api/v1/rules/${RULE_ID}?orgId=forged`, "reader");
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "RESOURCE_NOT_FOUND");
  });
  assert.deepEqual(harness.detailInputs, [{ orgId: "org-alpha", ruleId: RULE_ID }]);
});

for (const role of ["admin", "security_engineer"] as const) {
  test(`RULE-02B permits ${role} to create a rule using the trusted tenant and actor`, async () => {
    const harness = createHarness();
    harness.addToken(`${role}-creator`, role, `org-${role}`);
    const response = await withServer(harness.app, (baseUrl) =>
      requestPost(baseUrl, "/api/v1/rules?orgId=forged", `${role}-creator`, {
        yamlContent: "title: Test\n",
      }),
    );
    assert.equal(response.status, 201);
    assert.equal(harness.createInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.createInputs[0]?.actor.role, role);
    assert.equal(harness.createInputs[0]?.yamlContent, "title: Test\n");
  });
}

test("RULE-02B denies SOC Analysts before rule validation", async () => {
  const harness = createHarness();
  harness.addToken("analyst", "soc_analyst", "org-alpha");
  const response = await withServer(harness.app, (baseUrl) =>
    requestPost(baseUrl, "/api/v1/rules", "analyst", { yamlContent: "bad" }),
  );
  assert.equal(response.status, 403);
  assert.equal(harness.createInputs.length, 0);
});

test("RULE-02B maps Sigma validation and duplicate failures to stable API errors", async () => {
  const harness = createHarness();
  harness.addToken("engineer", "security_engineer", "org-alpha");
  harness.createError = new RuleValidationError([
    { path: "logsource.class_uid", message: "is required" },
  ]);
  const invalid = await withServer(harness.app, (baseUrl) =>
    requestPost(baseUrl, "/api/v1/rules", "engineer", { yamlContent: "title: Invalid" }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "RULE_VALIDATION_FAILED");

  harness.createError = new DuplicateSigmaRuleError("sigmaId", "rule-duplicate");
  const duplicate = await withServer(harness.app, (baseUrl) =>
    requestPost(baseUrl, "/api/v1/rules", "engineer", { yamlContent: "title: Duplicate" }),
  );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "RULE_ID_EXISTS");
});

test("RULE-02B rejects unknown fields and oversized UTF-8 YAML at the HTTP boundary", async () => {
  const harness = createHarness();
  harness.addToken("engineer", "security_engineer", "org-alpha");
  const unknown = await withServer(harness.app, (baseUrl) =>
    requestPost(baseUrl, "/api/v1/rules", "engineer", {
      yamlContent: "title: Test",
      orgId: "forged",
    }),
  );
  assert.equal(unknown.status, 400);

  const oversized = await withServer(harness.app, (baseUrl) =>
    requestPost(baseUrl, "/api/v1/rules", "engineer", {
      yamlContent: "é".repeat(30_000),
    }),
  );
  assert.equal(oversized.status, 400);
  assert.equal(harness.createInputs.length, 0);
});

for (const role of ["admin", "security_engineer"] as const) {
  test(`RULE-02C permits ${role} to update, enable, and disable using trusted identity`, async () => {
    const harness = createHarness();
    harness.addToken(`${role}-commands`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}?orgId=forged`, `${role}-commands`, { yamlContent: "title: Updated\n" })).status, 200);
      assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}/enable`, `${role}-commands`)).status, 200);
      assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}/disable`, `${role}-commands`)).status, 200);
    });
    assert.equal(harness.updateInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.updateInputs[0]?.actor.role, role);
    assert.equal(harness.statusInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.statusInputs[1]?.orgId, `org-${role}`);
  });
}

test("RULE-02C denies SOC Analysts before command execution", async () => {
  const harness = createHarness();
  harness.addToken("analyst-commands", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}`, "analyst-commands", { yamlContent: "bad" })).status, 403);
    assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}/enable`, "analyst-commands")).status, 403);
    assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}/disable`, "analyst-commands")).status, 403);
  });
  assert.equal(harness.updateInputs.length, 0);
  assert.equal(harness.statusInputs.length, 0);
});

test("RULE-02C rejects malformed command input before use-case execution", async () => {
  const harness = createHarness();
  harness.addToken("engineer-commands", "security_engineer", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await requestPut(baseUrl, "/api/v1/rules/not-a-uuid", "engineer-commands", { yamlContent: "test" })).status, 400);
    assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}`, "engineer-commands", { yamlContent: "test", orgId: "forged" })).status, 400);
    assert.equal((await requestPut(baseUrl, "/api/v1/rules/not-a-uuid/enable", "engineer-commands")).status, 400);
    assert.equal((await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}/disable`, "engineer-commands", { orgId: "forged" })).status, 400);
  });
  assert.equal(harness.updateInputs.length, 0);
  assert.equal(harness.statusInputs.length, 0);
});

test("RULE-02C maps command-domain failures to stable HTTP errors", async () => {
  const harness = createHarness();
  harness.addToken("engineer-errors", "security_engineer", "org-alpha");
  const cases: ReadonlyArray<[Error, number, string]> = [
    [new RuleCommandNotFoundError(RULE_ID), 404, "RESOURCE_NOT_FOUND"],
    [new CannotModifyBuiltinRuleError(RULE_ID), 403, "CANNOT_MODIFY_BUILTIN"],
    [new RuleIdentityImmutableError("old-id", "new-id"), 409, "RULE_ID_IMMUTABLE"],
    [new RuleStatusConflictError("archived", "update"), 409, "RULE_STATUS_CONFLICT"],
  ];
  await withServer(harness.app, async (baseUrl) => {
    for (const [error, status, code] of cases) {
      harness.updateError = error;
      const response = await requestPut(baseUrl, `/api/v1/rules/${RULE_ID}`, "engineer-errors", { yamlContent: "title: Test" });
      assert.equal(response.status, status);
      assert.equal(response.body.error.code, code);
    }
  });
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`RULE-02D permits ${role} to dry-run and export tenant rules`, async () => {
    const harness = createHarness();
    harness.addToken(`${role}-operations`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const dryRun = await requestPost(baseUrl, `/api/v1/rules/${RULE_ID}/test?orgId=forged`, `${role}-operations`, { timeRange: "24h", limit: 100 });
      assert.equal(dryRun.status, 200);
      const exported = await fetch(`${baseUrl}/api/v1/rules/export?status=active`, {
        headers: { authorization: `Bearer ${role}-operations` },
      });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-disposition") ?? "", /rules_export_20261026\.yaml/u);
      assert.equal(await exported.text(), "title: Exported\n");
    });
    assert.equal(harness.dryRunInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.dryRunInputs[0]?.timeRangeSeconds, 86_400);
    assert.deepEqual(harness.exportInputs[0], { orgId: `org-${role}`, status: "active" });
  });
}

for (const role of ["admin", "security_engineer"] as const) {
  test(`RULE-02D permits ${role} to import multi-document YAML`, async () => {
    const harness = createHarness();
    harness.addToken(`${role}-import`, role, `org-${role}`);
    const response = await withServer(harness.app, (baseUrl) =>
      requestYaml(baseUrl, "/api/v1/rules/import", `${role}-import`, "title: Imported\n"),
    );
    assert.equal(response.status, 200);
    assert.equal(harness.importInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.importInputs[0]?.actor.role, role);
  });
}

test("RULE-02D restricts archive to Admin and protects built-in rules", async () => {
  const deniedHarness = createHarness();
  deniedHarness.addToken("archive-engineer", "security_engineer", "org-engineer");
  const denied = await withServer(deniedHarness.app, (baseUrl) =>
    requestDelete(baseUrl, `/api/v1/rules/${RULE_ID}`, "archive-engineer"),
  );
  assert.equal(denied.status, 403);
  assert.equal(deniedHarness.archiveInputs.length, 0);

  const harness = createHarness();
  harness.addToken("archive-admin", "admin", "org-admin");
  await withServer(harness.app, async (baseUrl) => {
    const archived = await requestDelete(baseUrl, `/api/v1/rules/${RULE_ID}`, "archive-admin");
    assert.equal(archived.status, 200);
    assert.equal(harness.archiveInputs[0]?.orgId, "org-admin");

    harness.archiveError = new CannotDeleteBuiltinRuleError(RULE_ID);
    const builtin = await requestDelete(baseUrl, `/api/v1/rules/${RULE_ID}`, "archive-admin");
    assert.equal(builtin.status, 403);
    assert.equal(builtin.body.error.code, "CANNOT_DELETE_BUILTIN");
  });
});

test("RULE-02D validates operational request formats before execution", async () => {
  const harness = createHarness();
  harness.addToken("operations", "admin", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await requestPost(baseUrl, `/api/v1/rules/${RULE_ID}/test`, "operations", { timeRange: "0h" })).status, 400);
    assert.equal((await requestPost(baseUrl, `/api/v1/rules/${RULE_ID}/test`, "operations", { limit: 1001 })).status, 400);
    assert.equal((await requestJson(baseUrl, "/api/v1/rules/export?status=unknown", "operations")).status, 400);
    assert.equal((await requestPost(baseUrl, "/api/v1/rules/import", "operations", { yamlContent: "title: Wrong type" })).status, 415);
  });
});

interface Harness {
  readonly app: Express;
  readonly listInputs: ListRulesQuery[];
  readonly detailInputs: GetRuleDetailQuery[];
  readonly createInputs: CreateRuleCommand[];
  readonly updateInputs: UpdateRuleCommand[];
  readonly statusInputs: ChangeRuleStatusCommand[];
  readonly archiveInputs: ArchiveRuleCommand[];
  readonly importInputs: ImportRulesCommand[];
  readonly dryRunInputs: RuleDryRunInput[];
  readonly exportInputs: ExportRulesInput[];
  detail: RuleDetailView | null;
  createError: Error | null;
  updateError: Error | null;
  archiveError: Error | null;
  addToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const listInputs: ListRulesQuery[] = [];
  const detailInputs: GetRuleDetailQuery[] = [];
  const createInputs: CreateRuleCommand[] = [];
  const updateInputs: UpdateRuleCommand[] = [];
  const statusInputs: ChangeRuleStatusCommand[] = [];
  const archiveInputs: ArchiveRuleCommand[] = [];
  const importInputs: ImportRulesCommand[] = [];
  const dryRunInputs: RuleDryRunInput[] = [];
  const exportInputs: ExportRulesInput[] = [];
  const harness: Harness = {
    app: express(), listInputs, detailInputs, createInputs, updateInputs, statusInputs, archiveInputs, importInputs, dryRunInputs, exportInputs, detail: null, createError: null, updateError: null, archiveError: null,
    addToken(token, role, orgId) {
      const jti = `jwt-${token}`;
      const now = Math.floor(Date.now() / 1_000);
      jwtService.tokens.set(token, { sub: USER_ID, username: "rule-reader", role, jti, iat: now, exp: now + 3600, iss: "ai-siem" });
      sessions.set(jti, session(jti));
      users.set(USER_ID, user(role, orgId));
    },
  };
  harness.app.use(express.json({ limit: "1mb" }));
  harness.app.use("/api/v1/rules", createRuleQueryRouter({
    authentication: {
      jwtService,
      sessionRepository: { async findByJwtId(id) { return sessions.get(id) ?? null; } },
      userRepository: { async findById(id) { return users.get(id) ?? null; } },
      config: TEST_CONFIG,
    },
    listRulesUseCase: {
      async execute(input) {
        listInputs.push(input);
        return { data: [], pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0, hasNext: false, hasPrev: input.page > 1 } };
      },
    },
    getRuleDetailUseCase: {
      async execute(input) { detailInputs.push(input); return harness.detail; },
    },
    createRuleUseCase: {
      async execute(input) {
        if (harness.createError !== null) throw harness.createError;
        createInputs.push(input);
        return {
          id: RULE_ID,
          sigmaId: "rule-created",
          name: "Created rule",
          status: "active",
          type: "match",
          severity: "high",
          version: 1,
          createdAt: new Date("2026-10-23T00:00:00.000Z"),
          reloadSignaled: true,
        };
      },
    },
    updateRuleUseCase: {
      async execute(input) {
        if (harness.updateError !== null) throw harness.updateError;
        updateInputs.push(input);
        return {
          id: input.ruleId,
          sigmaId: "rule-created",
          name: "Updated rule",
          status: "active",
          type: "match",
          severity: "high",
          version: 2,
          updatedAt: new Date("2026-10-26T00:00:00.000Z"),
          reloadSignaled: true,
        };
      },
    },
    enableRuleUseCase: {
      async execute(input) {
        statusInputs.push(input);
        return { id: input.ruleId, status: "active", updatedAt: new Date("2026-10-26T00:00:00.000Z"), reloadSignaled: true };
      },
    },
    disableRuleUseCase: {
      async execute(input) {
        statusInputs.push(input);
        return { id: input.ruleId, status: "disabled", updatedAt: new Date("2026-10-26T00:00:00.000Z"), reloadSignaled: true };
      },
    },
    archiveRuleUseCase: {
      async execute(input) {
        if (harness.archiveError !== null) throw harness.archiveError;
        archiveInputs.push(input);
        return { id: input.ruleId, status: "archived", updatedAt: new Date("2026-10-26T00:00:00.000Z"), reloadSignaled: true };
      },
    },
    importRulesUseCase: {
      async execute(input) {
        importInputs.push(input);
        return { imported: 1, skipped: 0, failed: 0, results: [{ document: 1, id: "rule-imported", name: "Imported", status: "imported" }], reloadSignaled: true };
      },
    },
    dryRunRuleUseCase: {
      async execute(input) {
        dryRunInputs.push(input);
        return { ruleId: input.ruleId, sigmaId: "rule-test", ruleName: "Test", totalEvaluated: 0, matches: 0, matchedEventIds: [], executionTimeMs: 1, sampleMatches: [] };
      },
    },
    exportRulesUseCase: {
      async execute(input) {
        exportInputs.push(input);
        return { content: "title: Exported\n", filename: "rules_export_20261026.yaml", count: 1 };
      },
    },
  }));
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly tokens = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.tokens.get(token);
    if (claims === undefined) throw new Error("Unknown token");
    return claims;
  }
}

function session(jwtId: string): SessionRecord {
  return { id: `session-${jwtId}`, userId: USER_ID, jwtId, ipAddress: null, userAgent: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null };
}

function user(role: AuthRole, orgId: string): UserRecord {
  return { id: USER_ID, username: "rule-reader", email: "rule-reader@example.test", passwordHash: "test", role, displayName: "Rule Reader", isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId };
}

async function requestJson(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() as any };
}

async function requestPost(
  baseUrl: string,
  path: string,
  token: string,
  body: Readonly<Record<string, unknown>>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function requestPut(
  baseUrl: string,
  path: string,
  token: string,
  body?: Readonly<Record<string, unknown>>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as any };
}

async function requestDelete(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() as any };
}

async function requestYaml(baseUrl: string, path: string, token: string, body: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "text/yaml",
    },
    body,
  });
  return { status: response.status, body: await response.json() as any };
}

async function withServer<TResult>(app: Express, callback: (baseUrl: string) => Promise<TResult>): Promise<TResult> {
  const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  try { return await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
}

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: { DATABASE_URL: "postgres://test", MONGODB_URI: "mongodb://test", REDIS_URL: "redis://test", postgres: { poolMin: 0, poolMax: 1, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 }, mongodb: { poolSize: 1, serverSelectionTimeoutMs: 1000 }, redis: { keyPrefix: "test" } },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-rule-query-tests", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } },
  auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 },
  security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-secret" },
  collector: { directory: "./collector", trust: { collectorId: "test", keyId: "test", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } },
  ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 },
  frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};
