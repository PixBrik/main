import { randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  generateTemporaryPassword,
  hashStaffPassword
} from "../src/lib/auth/password.ts";

const databaseUrl = process.env.IDENTITY_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "IDENTITY_DATABASE_URL is required; bootstrap must use the execute-only identity credential"
  );
}
if (process.env.CONFIRM_OWNER_BOOTSTRAP !== "sam@benisty.ca") {
  throw new Error("Set CONFIRM_OWNER_BOOTSTRAP=sam@benisty.ca to confirm the exact bootstrap target");
}
if (process.env.CONFIRM_TEMP_PASSWORD_OUTPUT !== "sam@benisty.ca") {
  throw new Error(
    "Set CONFIRM_TEMP_PASSWORD_OUTPUT=sam@benisty.ca to acknowledge that a one-time password will be printed"
  );
}
if (process.env.CI && process.env.ALLOW_CI_TEMP_PASSWORD_OUTPUT !== "1") {
  throw new Error("Refusing to print a temporary password in CI; run this command from a controlled shell");
}

const temporaryPassword = generateTemporaryPassword();
const { hash, pepperVersion } = await hashStaffPassword(temporaryPassword);
const requestId = randomUUID();

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: { application_name: "pixbrik-local-owner-bootstrap" }
});

let bootstrapError;
try {
  const rows = await sql`
    SELECT
      user_id::text,
      temporary_password_expires_at
    FROM pixbrik.bootstrap_seeded_local_owner(
      ${hash},
      ${pepperVersion},
      ${requestId}::uuid
    )
  `;

  if (rows.length !== 1 || !rows[0]?.user_id) {
    throw new Error("The seeded PixBrik owner was not bootstrapped");
  }

  // This is intentionally the only statement that emits the plaintext. The
  // hash, pepper, connection URL, and raw temporary value are never logged.
  process.stdout.write(
    `Temporary PixBrik admin password for sam@benisty.ca (shown once): ${temporaryPassword}\n`
  );
  process.stdout.write(
    `Change it before ${new Date(rows[0].temporary_password_expires_at).toISOString()}.\n`
  );
} catch (error) {
  bootstrapError = error;
}

try {
  await sql.end({ timeout: 5 });
} catch (error) {
  if (!bootstrapError) throw error;
}

if (bootstrapError) throw bootstrapError;
