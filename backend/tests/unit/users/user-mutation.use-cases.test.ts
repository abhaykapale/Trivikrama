import assert from "node:assert/strict";
import test from "node:test";

import { ResetUserPasswordUseCase } from "../../../src/modules/users/application/use-case/reset-user-password.use-case.js";
import { UpdateUserUseCase } from "../../../src/modules/users/application/use-case/update-user.use-case.js";
import type { IUserMutationUnitOfWork, UserMutationAuditInput, UserMutationTransactionContext } from "../../../src/modules/users/domain/user-mutation.contracts.js";
import type { MutatedManagedUser } from "../../../src/modules/users/domain/user-mutation.contracts.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440002";

class FakeUnitOfWork implements IUserMutationUnitOfWork {
  public readonly auditEntries: UserMutationAuditInput[] = [];
  public user: MutatedManagedUser = { id: USER_ID, username: "analyst", role: "soc_analyst", displayName: "SOC Analyst", updatedAt: new Date("2026-08-26T10:00:00.000Z") };
  public found = true;
  public passwordHashes: string[] = [];
  public async execute<TResult>(operation: (context: UserMutationTransactionContext) => Promise<TResult>): Promise<TResult> {
    return operation({
      users: {
        updateUser: async (input) => {
          if (!this.found) return null;
          this.user = { ...this.user, role: input.role ?? this.user.role, displayName: input.displayName === undefined ? this.user.displayName : input.displayName };
          return this.user;
        },
        resetPassword: async (input) => {
          if (!this.found) return null;
          this.passwordHashes.push(input.passwordHash);
          return this.user;
        },
      },
      audit: { record: async (entry) => { this.auditEntries.push(entry); } },
    });
  }
}

const actor = { actorId: "550e8400-e29b-41d4-a716-446655440001", actorUsername: "admin", actorRole: "admin" as const, ipAddress: "127.0.0.1", orgId: "org-123" };

test("UpdateUserUseCase returns the documented safe response and audit entry", async () => {
  const unitOfWork = new FakeUnitOfWork();
  const result = await new UpdateUserUseCase(unitOfWork).execute({ ...actor, userId: USER_ID, role: "admin", displayName: "Lead" });
  assert.deepEqual(result, { id: USER_ID, role: "admin", displayName: "Lead", updatedAt: "2026-08-26T10:00:00.000Z" });
  assert.deepEqual(unitOfWork.auditEntries[0]?.changedFields, ["role", "displayName"]);
  assert.equal(unitOfWork.auditEntries[0]?.action, "user_update");
});

test("ResetUserPasswordUseCase hashes the password and never returns it", async () => {
  const unitOfWork = new FakeUnitOfWork();
  const result = await new ResetUserPasswordUseCase({ hash: async (value) => `hash:${value}` }, unitOfWork).execute({ ...actor, userId: USER_ID, newPassword: "NewSecureP@ss456!" });
  assert.deepEqual(result, { message: "Password reset successfully", userId: USER_ID });
  assert.deepEqual(unitOfWork.passwordHashes, ["hash:NewSecureP@ss456!"]);
  assert.equal(unitOfWork.auditEntries[0]?.action, "user_password_reset");
});

test("both mutation use cases return a generic user-not-found application error", async () => {
  const unitOfWork = new FakeUnitOfWork();
  unitOfWork.found = false;
  await assert.rejects(() => new UpdateUserUseCase(unitOfWork).execute({ ...actor, userId: USER_ID, role: "admin" }), { message: "User not found." });
  await assert.rejects(() => new ResetUserPasswordUseCase({ hash: async () => "hash" }, unitOfWork).execute({ ...actor, userId: USER_ID, newPassword: "NewSecureP@ss456!" }), { message: "User not found." });
});
