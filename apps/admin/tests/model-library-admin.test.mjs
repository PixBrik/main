import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/(admin)/models/page.tsx", import.meta.url), "utf8");
const actions = await readFile(new URL("../src/app/(admin)/models/actions.ts", import.meta.url), "utf8");
const repository = await readFile(new URL("../src/lib/model-library.ts", import.meta.url), "utf8");
const hardening = await readFile(new URL("../migrations/0005_security_hardening.sql", import.meta.url), "utf8");
const sourceUniqueness = await readFile(
  new URL("../migrations/0008_model_library_source_uniqueness.sql", import.meta.url),
  "utf8"
);

test("model library is a real database-backed route with honest empty states", () => {
  assert.match(page, /requirePermission\("models\.read"\)/);
  assert.match(page, /getModelLibrarySnapshot\(\)/);
  assert.match(page, /CreateModelCategoryForm/);
  assert.match(page, /CreateModelItemForm/);
  assert.match(page, /AttachModelVersionForm/);
  assert.doesNotMatch(page, /Connect PostgreSQL|No production records yet/);
  assert.match(page, /No categories yet/);
  assert.match(page, /No approved build is ready yet/);
});

test("every model mutation reauthorizes and verifies same-origin requests", () => {
  const exportedActions = actions.match(/export async function [A-Za-z]+Action/g) ?? [];
  assert.equal(exportedActions.length, 6);
  assert.equal((actions.match(/requirePermission\("models\.publish"\)/g) ?? []).length, exportedActions.length);
  assert.equal((actions.match(/requireTrustedMutation\(\)/g) ?? []).length, exportedActions.length);
  assert.match(actions, /INSERT INTO pixbrik\.audit_event/);
  assert.match(actions, /admin_module/);
});

test("library versions only promote locked approved builds and avoid duplicate source assets", () => {
  for (const source of [repository, actions]) {
    assert.match(source, /build_version\.locked_at IS NOT NULL/);
    assert.match(source, /build_version\.status IN \('approved', 'published'\)/);
    assert.match(source, /NOT EXISTS \([\s\S]*model_library_version/);
  }
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /model-library-build:/);
  assert.match(actions, /COALESCE\(max\(version_number\), 0\) \+ 1/);
  assert.match(sourceUniqueness, /CREATE UNIQUE INDEX model_library_version_build_version_unique_idx/);
});

test("publishing is staged and live items cannot lose their only published version", () => {
  assert.match(actions, /draft: \["review"\]/);
  assert.match(actions, /review: \["draft", "published"\]/);
  assert.match(actions, /Publish a reviewed library version before publishing the model/);
  assert.match(actions, /Enable the model category before publishing this model/);
  assert.equal((actions.match(/model-library-category:/g) ?? []).length, 2);
  assert.match(actions, /Publish a replacement version or retire the model before retiring its live version/);
  assert.match(actions, /SET status = 'retired', retired_at = now\(\)/);
  assert.match(actions, /model_library_version\.auto_retired/);
  assert.match(actions, /model_library_version\.replaced/);
});

test("existing database policy grants the isolated admin role model-library access", () => {
  assert.match(hardening, /model_category, model_library_item, model_library_version/);
  assert.match(hardening, /CREATE POLICY %I ON pixbrik\.%I FOR ALL USING \(pixbrik\.request_is_admin_database_role\(\)/);
  assert.match(hardening, /GRANT INSERT, UPDATE ON[\s\S]*model_category, model_library_item, model_library_version/);
});
