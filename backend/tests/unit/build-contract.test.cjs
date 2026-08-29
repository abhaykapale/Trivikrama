const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "../..");
const packageJsonPath = path.join(backendRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const expectedCommands = {
  start: "node dist/src/main.js",
  "migrate:prod": "node dist/src/scripts/migrate.js latest",
  "db:mongo:bootstrap:prod": "node dist/src/scripts/mongo-bootstrap.js apply",
  "db:redis:verify:prod": "node dist/src/scripts/redis-verify.js verify",
  "db:verify:prod": "node dist/src/scripts/db-verify.js verify",
  "db:maintenance:prod": "node dist/src/scripts/db-maintenance.js run",
};

test("package metadata and production scripts target the compiled src output", () => {
  assert.equal(packageJson.main, "dist/src/main.js");

  for (const [scriptName, expectedCommand] of Object.entries(expectedCommands)) {
    assert.equal(packageJson.scripts[scriptName], expectedCommand);
  }
});

test("STB-003 references the existing shared HTTP contract test", () => {
  assert.match(
    packageJson.scripts["test:stb003"],
    /tests\/unit\/shared\/http-contract\.test\.ts/u,
  );
  assert.doesNotMatch(packageJson.scripts["test:stb003"], /http-contracts\.test/u);
});

if (process.argv.includes("--verify-dist")) {
  test("compiled production entrypoints exist after build", () => {
    const artifactPaths = [
      "dist/src/main.js",
      "dist/src/scripts/migrate.js",
      "dist/src/scripts/mongo-bootstrap.js",
      "dist/src/scripts/redis-verify.js",
      "dist/src/scripts/db-verify.js",
      "dist/src/scripts/db-maintenance.js",
    ];

    for (const artifactPath of artifactPaths) {
      assert.equal(
        fs.existsSync(path.join(backendRoot, artifactPath)),
        true,
        `Expected compiled artifact ${artifactPath} to exist. Run npm run build first.`,
      );
    }
  });
}
