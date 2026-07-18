import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bootstrap = await readFile(
  new URL("../scripts/bootstrap-local-owner.mjs", import.meta.url),
  "utf8"
);
const recovery = await readFile(
  new URL("../scripts/recover-local-owner.mjs", import.meta.url),
  "utf8"
);

test("owner bootstrap requires explicit target and output acknowledgement", () => {
  assert.match(bootstrap, /CONFIRM_OWNER_BOOTSTRAP/);
  assert.match(bootstrap, /CONFIRM_TEMP_PASSWORD_OUTPUT/);
  assert.match(bootstrap, /ALLOW_CI_TEMP_PASSWORD_OUTPUT/);
  assert.equal((bootstrap.match(/\$\{temporaryPassword\}/g) ?? []).length, 1);
});

test("owner recovery is deployment-only, reasoned, and explicitly acknowledged", () => {
  assert.match(recovery, /MIGRATION_DATABASE_URL/);
  assert.match(recovery, /CONFIRM_OWNER_RECOVERY/);
  assert.match(recovery, /OWNER_RECOVERY_REASON/);
  assert.match(recovery, /CONFIRM_TEMP_PASSWORD_OUTPUT/);
  assert.match(recovery, /ALLOW_CI_TEMP_PASSWORD_OUTPUT/);
  assert.equal((recovery.match(/\$\{temporaryPassword\}/g) ?? []).length, 1);
});

for (const [name, source] of [["bootstrap", bootstrap], ["recovery", recovery]]) {
  test(`${name} never uses general-purpose console logging`, () => {
    assert.doesNotMatch(source, /console\.(?:log|error)/);
  });
}
