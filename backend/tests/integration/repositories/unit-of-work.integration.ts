import crypto from "node:crypto";

import type { IntegrationTestCase } from "./test-harness.js";
import {
  TEST_ORG_ID,
  assertDefined,
  assertEqual,
  assertTrue,
  testUuid,
} from "./test-harness.js";

export const unitOfWorkIntegrationTests: readonly IntegrationTestCase[] = [
  {
    name: "unit of work commits repository writes atomically",
    run: async ({ repositories, unitOfWork }) => {
      const result = await unitOfWork.execute(async ({ repositories: txRepositories, attempt }) => {
        const user = await txRepositories.users.create({
          id: testUuid("101"),
          username: "db09_uow_commit",
          email: "db09-uow-commit@example.local",
          passwordHash: "$2b$12$db09integrationtesthashplaceholder0000000000000000101",
          role: "security_engineer",
          displayName: "DB09 UOW Commit",
          orgId: TEST_ORG_ID,
        });

        const audit = await txRepositories.audit.create({
          id: crypto.randomUUID(),
          action: "user_create",
          actorId: null,
          actorUsername: user.username,
          actorRole: user.role,
          targetType: "user",
          targetId: user.id,
          targetName: user.username,
          details: { attempt },
          orgId: TEST_ORG_ID,
        });

        return { userId: user.id, auditId: audit.id, attempt };
      }, {
        isolationLevel: "read committed",
        statementTimeoutMs: 5_000,
        lockTimeoutMs: 2_000,
      });

      assertEqual(result.attempt, 1, "Successful transaction should complete on first attempt");

      const user = await repositories.users.findById(result.userId);
      assertDefined(user, "Committed transaction should persist user");

      const audit = await repositories.audit.findById(result.auditId);
      assertDefined(audit, "Committed transaction should persist audit record");
    },
  },
  {
    name: "unit of work rolls back repository writes on error",
    run: async ({ repositories, unitOfWork }) => {
      const userId = testUuid("111");

      let thrown = false;
      try {
        await unitOfWork.execute(async ({ repositories: txRepositories }) => {
          await txRepositories.users.create({
            id: userId,
            username: "db09_uow_rollback",
            email: "db09-uow-rollback@example.local",
            passwordHash: "$2b$12$db09integrationtesthashplaceholder0000000000000000111",
            role: "soc_analyst",
            displayName: "DB09 UOW Rollback",
            orgId: TEST_ORG_ID,
          });

          throw new Error("intentional rollback test");
        }, {
          isolationLevel: "read committed",
          retry: {
            maxAttempts: 1,
          },
        });
      } catch (error) {
        thrown = error instanceof Error && error.message === "intentional rollback test";
      }

      assertTrue(thrown, "Rollback test should throw the intentional error");

      const user = await repositories.users.findById(userId);
      assertEqual(user, null, "Rolled-back transaction should not persist user");
    },
  },
  {
    name: "unit of work retries PostgreSQL serialization failures",
    run: async ({ repositories, unitOfWork }) => {
      let attempts = 0;

      const result = await unitOfWork.execute(async ({ repositories: txRepositories }) => {
        attempts += 1;

        if (attempts === 1) {
          const serializationError = new Error("simulated serialization failure") as Error & { code?: string };
          serializationError.code = "40001";
          throw serializationError;
        }

        const user = await txRepositories.users.create({
          id: testUuid("121"),
          username: "db09_uow_retry",
          email: "db09-uow-retry@example.local",
          passwordHash: "$2b$12$db09integrationtesthashplaceholder0000000000000000121",
          role: "soc_analyst",
          displayName: "DB09 UOW Retry",
          orgId: TEST_ORG_ID,
        });

        return user.id;
      }, {
        retry: {
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      });

      assertEqual(attempts, 2, "Unit of work should retry the simulated serialization failure");

      const user = await repositories.users.findById(result);
      assertDefined(user, "Retried transaction should persist final attempt");
    },
  },
];
