import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../scripts/provision-database-roles.mjs", import.meta.url),
  "utf8"
);
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const prepare = await readFile(
  new URL("../scripts/prepare-database-provisioning.ps1", import.meta.url),
  "utf8"
);
const resume = await readFile(
  new URL("../scripts/resume-database-provisioning.ps1", import.meta.url),
  "utf8"
);

test("database provisioning is explicit, clean-database-only, and non-rotating", () => {
  assert.match(source, /CONFIRM_DATABASE_PROVISIONING/);
  assert.match(source, /Refusing to rotate an existing PixBrik role/);
  assert.match(source, /already contains PixBrik migrations/);
  assert.match(source, /current_user !== identity\.session_user/);
});

test("database provisioning creates every isolated role with hardened attributes", () => {
  for (const role of ["migrator", "admin_runtime", "customer_runtime", "identity_runtime", "service_runtime"]) {
    assert.match(source, new RegExp(`pixbrik_${role}`));
  }
  assert.match(source, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
});

test("only pooled runtime URLs and authentication values are rendered for Vercel", () => {
  assert.match(source, /pooledRuntimeBase/);
  assert.match(source, /-pooler/);
  assert.doesNotMatch(source, /MIGRATION_DATABASE_URL=/);
  assert.match(source, /AUTH_MODE=password/);
  assert.match(source, /AUTH_PASSWORD_PEPPER=/);
  assert.match(source, /AUTH_SESSION_HMAC_KEY=/);
});

test("secrets are encrypted before role creation and recoverable without rotation", () => {
  assert.ok(prepare.indexOf("ConvertFrom-SecureString") < prepare.indexOf("'--apply'"));
  assert.match(prepare, /initial-\{0\}\.dpapi/);
  assert.match(resume, /'--render'/);
  assert.match(resume, /\[switch\]\$ApplyRoles/);
});

test("the documented Vercel import is explicitly Production-only", () => {
  assert.match(readme, /Production only/);
  assert.match(readme, /leave Preview and Development\s+unchecked/);
  assert.match(readme, /prepare-database-provisioning\.ps1/);
});
