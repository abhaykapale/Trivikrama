import test from "node:test";
import assert from "node:assert/strict";


import {
  createUserBodySchema,
  listUsersQuerySchema,
  resetUserPasswordBodySchema,
  updateUserBodySchema,
} from "../../../src/modules/users/http/user.schema";

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

test("createUserBodySchema accepts and normalizes a valid user", () => {
  const result = createUserBodySchema.parse({
    username: "  agarcia  ",
    email: "  AGARCIA@CORP.LOCAL  ",
    password: "InitialP@ss123!",
    role: "security_engineer",
    displayName: "  Ana Garcia  ",
  });

  assert.deepEqual(result, {
    username: "agarcia",
    email: "agarcia@corp.local",
    password: "InitialP@ss123!",
    role: "security_engineer",
    displayName: "Ana Garcia",
  });
});

test("updateUserBodySchema accepts a role and nullable display name", () => {
  assert.deepEqual(updateUserBodySchema.parse({ role: "admin", displayName: null }), {
    role: "admin", displayName: null,
  });
});

test("updateUserBodySchema rejects an empty or injected body", () => {
  assert.throws(() => updateUserBodySchema.parse({}));
  assert.throws(() => updateUserBodySchema.parse({ isActive: false }));
});

test("resetUserPasswordBodySchema accepts only a strong new password", () => {
  assert.deepEqual(resetUserPasswordBodySchema.parse({ newPassword: "NewSecureP@ss456!" }), {
    newPassword: "NewSecureP@ss456!",
  });
  assert.throws(() => resetUserPasswordBodySchema.parse({ newPassword: "weak" }));
  assert.throws(() => resetUserPasswordBodySchema.parse({ newPassword: "NewSecureP@ss456!", orgId: "other-org" }));
});

test("createUserBodySchema rejects weak passwords", () => {
  assert.throws(() =>
    createUserBodySchema.parse({
      username: "agarcia",
      email: "agarcia@corp.local",
      password: "weakpassword",
      role: "security_engineer",
    }),
  );
});

test("createUserBodySchema rejects passwords beyond bcrypt's byte limit", () => {
  assert.throws(() =>
    createUserBodySchema.parse({
      username: "agarcia",
      email: "agarcia@corp.local",
      password: `Aa1!${"x".repeat(69)}`,
      role: "security_engineer",
    }),
  );
});

test("createUserBodySchema rejects organization and status injection", () => {
  assert.throws(() =>
    createUserBodySchema.parse({
      username: "agarcia",
      email: "agarcia@corp.local",
      password: "InitialP@ss123!",
      role: "security_engineer",
      orgId: "attacker-org",
      isActive: false,
    }),
  );
});

