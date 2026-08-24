require("dotenv").config({ quiet: true });

const bcrypt = require("bcrypt");
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  try {
    const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);

    const hash = await bcrypt.hash(process.env.RESET_ADMIN_PASSWORD, rounds);

    const result = await client.query(
      `UPDATE public.users
       SET password_hash = $1,
           failed_login_count = 0,
           locked_until = NULL,
           is_active = TRUE,
           updated_at = NOW()
       WHERE username = $2
         AND role = $3`,
      [hash, process.env.RESET_ADMIN_USERNAME, "admin"],
    );

    if (result.rowCount !== 1) {
      throw new Error("Exactly one Admin user was not found.");
    }

    console.log("Admin password reset succeeded.");
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
