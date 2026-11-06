import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("RULE-02D dry-run Mongo reads are tenant/class/time bounded and safely projected", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/modules/detection/infrastructure/mongo-rule-dry-run-event.repository.ts"),
    "utf8",
  );
  assert.match(source, /org_id:/u);
  assert.match(source, /class_uid:/u);
  assert.match(source, /time: \{ \$gte: input\.from, \$lte: input\.to \}/u);
  assert.match(source, /\.limit\(input\.limit\)/u);
  const projection = source.slice(
    source.indexOf("const SAFE_PROJECTION"),
    source.indexOf("function toDetectionEvent"),
  );
  assert.doesNotMatch(projection, /raw_event/u);
  assert.doesNotMatch(projection, /unmapped/u);
  assert.doesNotMatch(projection, /org_id/u);
});

test("RULE-02D dry-run application has no Redis or persistence dependency", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/modules/detection/application/dry-run-rule.use-case.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /Redis|windowStore|cooldownStore|alerts|incidents/u);
  assert.match(source, /evaluateMatch/u);
  assert.match(source, /evaluateCount/u);
});
