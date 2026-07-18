import { randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  generateTemporaryPassword,
  hashStaffPassword
} from "../src/lib/auth/password.ts";

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for deployment-only owner recovery");
}
if (process.env.CONFIRM_OWNER_RECOVERY !== "sam@benisty.ca") {
  throw new Error("Set CONFIRM_OWNER_RECOVERY=sam@benisty.ca to confirm the exact recovery target");
}
if (process.env.CONFIRM_TEMP_PASSWORD_OUTPUT !== "sam@benisty.ca") {
  throw new Error(
    "Set CONFIRM_TEMP_PASSWORD_OUTPUT=sam@benisty.ca to acknowledge that a one-time password will be printed"
  );
}
if (process.env.CI && process.env.ALLOW_CI_TEMP_PASSWORD_OUTPUT !== "1") {
  throw new Error("Refusing to print a temporary password in CI; run this command from a controlled shell");
}
const recoveryReason = process.env.OWNER_RECOVERY_REASON?.trim();
if (!recoveryReason || recoveryReason.length < 10 || recoveryReason.length > 500) {
  throw new Error("OWNER_RECOVERY_REASON must contain between 10 and 500 characters");
}

const temporaryPassword = generateTemporaryPassword();
const { hash, pepperVersion } = await hashStaffPassword(temporaryPassword);
const requestId = randomUUID();
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: { application_name: "pixbrik-local-owner-recovery" }
});

let recoveryError;
try {
  const rows = await sql`
    SELECT user_id::text, temporary_password_expires_at
    FROM pixbrik.recover_seeded_local_owner(
      ${hash},
      ${pepperVersion},
      ${requestId}::uuid,
      ${recoveryReason}
    )
  `;
  if (rows.length !== 1 || !rows[0]?.user_id) {
    throw new Error("The seeded PixBrik owner was not recovered");
  }

  process.stdout.write(
    `Emergency temporary PixBrik admin password for sam@benisty.ca (shown once): ${temporaryPassword}\n`
  );
  process.stdout.write(
    `Change it before ${new Date(rows[0].temporary_password_expires_at).toISOString()}.\n`
  );
} catch (error) {
  recoveryError = error;
}

try {
  await sql.end({ timeout: 5 });
} catch (error) {
  if (!recoveryError) throw error;
}

if (recoveryError) throw recoveryError;
