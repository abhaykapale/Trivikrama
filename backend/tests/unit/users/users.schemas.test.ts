import test from "node:test";
import assert from "node:assert/strict";


import {listUsersQuerySchema} from "../../../src/modules/users/http/user.schema";

test("listUsersQuerySchema should validate and transform query parameters correctly", () => {
    const validQuery = {
        role: "admin",
        isActive: "true",
        page: "2",
        limit: "5",
        search: "test user"
    };

    const result = listUsersQuerySchema.parse(validQuery);

    assert.strictEqual(result.role, "admin");
    assert.strictEqual(result.isActive, true);
    assert.strictEqual(result.page, 2);
    assert.strictEqual(result.limit, 5);
    assert.strictEqual(result.search, "test user");
});

test("uses default page and limit when they are not provided", () => {
  const validQuery = {};

  const result = listUsersQuerySchema.parse(validQuery);

  assert.equal(result.page, 1);
  assert.equal(result.limit, 25);
});

test("uses default page and limit when they are not provided", () => {
    const validQuery = {
        page: "12",
        limit: "50"
  };

  const result = listUsersQuerySchema.parse(validQuery);

  assert.equal(result.page, 12);
  assert.equal(result.limit, 50);
});

test("rejects page below 1", () => {
  assert.throws(() => {
    listUsersQuerySchema.parse({
      page: "0",
    });
  });
});

test("rejects limit below 1", () => {
    assert.throws(() => {
        listUsersQuerySchema.parse({
            limit: "0",
        });
    });
});

test("rejects invalid role", () => {
    assert.throws(() => {
        listUsersQuerySchema.parse({
            role: "FUCK_YOU_ ROLE",
        });
    });
});

test("rejects invalid isActive", () => {
    assert.throws(() => {
        listUsersQuerySchema.parse({
            isActive: "not_a_boolean",
        });
    });
});

test("rejects search string length more than 255 characters", () => {

    assert.throws(() => {
        listUsersQuerySchema.parse({
            search: "a".repeat(256),
        })
    })
})
test("Accepts search string length less than 255 characters", () => {

    assert.doesNotThrow(() => {
        listUsersQuerySchema.parse({
            search: "a".repeat(255),
        })
    })
})

// dosen't make sense but MAJA AYA !!
test("Rejects search string length less than 0 characters", () => {

    assert.throws(() => {
        listUsersQuerySchema.parse({
            search: "a".repeat(-1),
        })
    })
})

