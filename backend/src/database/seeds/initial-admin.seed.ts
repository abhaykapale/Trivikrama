import type { Knex } from "knex";

import type {
  ExistingUserConflictRow,
  ExistingAdminRow,
  SeedContext,
  SeedStepResult,
  UserTableRow,
} from "./seed.types.js";

const INITIAL_ADMIN_STEP_NAME = "initial-admin";
const DEFAULT_ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";
const BCRYPT_ROUNDS = 12;




export async function seedInitialAdministrator(
  context: SeedContext,
): Promise<SeedStepResult> {
  const config = context.initialAdmin;

  validateInitialAdminPassword(config.password);

  const existingAdmin = await findExistingAdmin(context.trx, config.orgId);

  if (existingAdmin) {
    return {
      name: INITIAL_ADMIN_STEP_NAME,
      status: "skipped",
      inserted: 0,
      updated: 0,
      skipped: 1,
      message: `Admin user already exists for org "${config.orgId}" as "${existingAdmin.username}". Existing passwords are never reset by the seed runner.`,
    };
  }

  const conflictingUser = await findUsernameOrEmailConflict(
    context.trx,
    config.username,
    config.email,
    config.orgId,
  );

  if (conflictingUser) {
    throw new Error(
      `Cannot seed initial admin because username or email is already used by non-admin user "${conflictingUser.username}" in org "${config.orgId}". Resolve this manually to avoid accidental privilege escalation.`,
    );
  }

  const passwordHash = await hashPasswordWithPgcrypto(context.trx, config.password);

  const insertedUser = await context.trx("public.users")
    .insert({
      id: DEFAULT_ADMIN_USER_ID,
      username: config.username,
      email: config.email,
      password_hash: passwordHash,
      role: "admin",
      display_name: config.displayName,
      is_active: true,
      failed_login_count: 0,
      org_id: config.orgId,
    })
    .returning<{ id: string }[]>("id");

  const adminUserId = insertedUser[0]?.id ?? DEFAULT_ADMIN_USER_ID;

  await context.trx("audit.audit_logs").insert({
    action: "user_create",
    actor_id: null,
    actor_username: "system_seed",
    actor_role: null,
    target_type: "user",
    target_id: adminUserId,
    target_name: config.username,
    details: {
      source: "database_seed",
      seed_step: INITIAL_ADMIN_STEP_NAME,
      password_hash_algorithm: "bcrypt",
      password_hash_rounds: BCRYPT_ROUNDS,
      password_was_seeded: true,
    },
    new_state: {
      username: config.username,
      email: config.email,
      role: "admin",
      display_name: config.displayName,
      is_active: true,
      org_id: config.orgId,
    },
    org_id: config.orgId,
  });

  return {
    name: INITIAL_ADMIN_STEP_NAME,
    status: "success",
    inserted: 1,
    updated: 0,
    skipped: 0,
    message:
      "Initial administrator created. Store the bootstrap password securely and rotate it after first login.",
  };
}

async function findExistingAdmin(
  trx: Knex.Transaction,
  orgId: string,
): Promise<ExistingAdminRow | undefined> {
  return trx<UserTableRow, ExistingAdminRow[]>("public.users")
    .select("id", "username", "email")
    .where({ role: "admin", org_id: orgId, is_active: true })
    .orderBy("created_at", "asc")
    .first();
}

async function findUsernameOrEmailConflict(
  trx: Knex.Transaction,
  username: string,
  email: string,
  orgId: string,
): Promise<ExistingUserConflictRow | undefined> {
  return trx<ExistingUserConflictRow>("public.users")
    .select("id", "username", "email", "role")
    .where("org_id", orgId)
    .andWhere((builder) => {
      builder.where("username", username).orWhere("email", email);
    })
    .first();
}

async function hashPasswordWithPgcrypto(
  trx: Knex.Transaction,
  password: string,
): Promise<string> {
  const result = await trx.raw<{ rows: { password_hash: string }[] }>(
    "select crypt(?, gen_salt('bf', ?)) as password_hash",
    [password, BCRYPT_ROUNDS],
  );
  const passwordHash = result.rows[0]?.password_hash;

  if (!passwordHash || !passwordHash.startsWith("$2")) {
    throw new Error("Failed to create bcrypt password hash with pgcrypto");
  }

  return passwordHash;
}

function validateInitialAdminPassword(password: string): void {
  if (password.length < 12) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be at least 12 characters");
  }

  if (!/[A-Z]/u.test(password)) {
    throw new Error("ADMIN_INITIAL_PASSWORD must contain at least one uppercase letter");
  }

  if (!/[a-z]/u.test(password)) {
    throw new Error("ADMIN_INITIAL_PASSWORD must contain at least one lowercase letter");
  }

  if (!/[0-9]/u.test(password)) {
    throw new Error("ADMIN_INITIAL_PASSWORD must contain at least one digit");
  }

  if (!/[^A-Za-z0-9]/u.test(password)) {
    throw new Error("ADMIN_INITIAL_PASSWORD must contain at least one special character");
  }
}
