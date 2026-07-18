import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../scripts/initialize-database-from-clipboard.ps1", import.meta.url),
  "utf8"
);

test("clipboard initialization permits only the Vercel runtime variable set", () => {
  for (const name of [
    "AUTH_PASSWORD_PEPPER",
    "AUTH_SESSION_HMAC_KEY",
    "IDENTITY_DATABASE_URL",
    "ADMIN_DATABASE_URL"
  ]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /unexpected or empty variable/);
  assert.match(source, /repeats a variable/);
});

test("clipboard initialization verifies pooled roles, one Neon branch, and encrypted secrets", () => {
  assert.match(source, /wrong database role/);
  assert.match(source, /does not match the encrypted role password/);
  assert.match(source, /pooled Neon runtime endpoint/);
  assert.match(source, /same Neon branch and database/);
  assert.match(source, /password pepper does not match the encrypted bundle/);
  assert.match(source, /Host = \$hostLabels -join/);
});

test("clipboard initialization migrates, bootstraps exact owner, then clears secrets", () => {
  const migrationIndex = source.indexOf("npm run db:migrate");
  const bootstrapIndex = source.indexOf("npm run auth:bootstrap-owner");
  const clearIndex = source.indexOf("Set-Clipboard -Value ' '");
  assert.ok(migrationIndex >= 0 && migrationIndex < bootstrapIndex);
  assert.ok(bootstrapIndex < clearIndex);
  assert.match(source, /CONFIRM_OWNER_BOOTSTRAP = 'sam@benisty\.ca'/);
  assert.match(source, /CONFIRM_TEMP_PASSWORD_OUTPUT = 'sam@benisty\.ca'/);
  assert.match(source, /Restore-ProcessEnvironment \$previousEnvironment/);
  assert.match(source, /Remove-Item -LiteralPath \$RecoveryFile -Force/);
});
