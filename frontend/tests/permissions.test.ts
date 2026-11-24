import assert from "node:assert/strict";
import test from "node:test";
import { getPermissionsForRole, roleHasPermission } from "../src/utils/permissions";

test("admin receives every defined operational permission", () => {
  assert.equal(getPermissionsForRole("admin").length, 21);
});

test("security engineer permissions mirror backend restrictions", () => {
  assert.equal(roleHasPermission("security_engineer", "incidents.assign"), true);
  assert.equal(roleHasPermission("security_engineer", "config.ai_threshold"), true);
  assert.equal(roleHasPermission("security_engineer", "config.view"), false);
  assert.equal(roleHasPermission("security_engineer", "rules.delete"), false);
  assert.equal(roleHasPermission("security_engineer", "users.manage"), false);
});

test("SOC analyst remains read-oriented", () => {
  assert.equal(roleHasPermission("soc_analyst", "incidents.view"), true);
  assert.equal(roleHasPermission("soc_analyst", "rules.test"), true);
  assert.equal(roleHasPermission("soc_analyst", "incidents.assign"), false);
  assert.equal(roleHasPermission("soc_analyst", "rules.edit"), false);
});
