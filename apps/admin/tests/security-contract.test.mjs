import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await readFile(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/app/(admin)/layout.tsx", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const migrationScript = await readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");
const rowSecurity = await readFile(new URL("../migrations/0003_security_boundaries.sql", import.meta.url), "utf8");
const operations = await readFile(new URL("../migrations/0004_operations_domains.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../migrations/0005_security_hardening.sql", import.meta.url), "utf8");
const clerkIdentity = await readFile(new URL("../migrations/0006_clerk_owner_identity.sql", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const databaseClient = await readFile(new URL("../src/lib/db.ts", import.meta.url), "utf8");
const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
const authProvider = await readFile(new URL("../src/components/auth-provider.tsx", import.meta.url), "utf8");
const signIn = await readFile(new URL("../src/app/sign-in/[[...sign-in]]/page.tsx", import.meta.url), "utf8");
const adminShell = await readFile(new URL("../src/components/admin-shell.tsx", import.meta.url), "utf8");
const avatar = await readFile(new URL("../src/components/brickling-avatar.tsx", import.meta.url), "utf8");

test("admin access is revalidated inside the server layout", () => {
  assert.match(layout, /requirePermission\("dashboard\.read"\)/);
  assert.match(auth, /u\.status = 'active'/);
  assert.match(auth, /role_permission/);
  assert.match(auth, /ur\.expires_at IS NULL OR ur\.expires_at > now\(\)/);
  assert.match(auth, /redirect\(APP_ROUTES\.signIn\)/);
});

test("trusted gateway identity requires a secret and constant-time comparison", () => {
  assert.match(auth, /AUTH_GATEWAY_SECRET/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /x-pixbrik-user-subject/);
});

test("Next 16 proxy installs Clerk context conditionally while server layouts authorize", () => {
  assert.match(proxy, /clerkMiddleware\(\{/);
  assert.match(proxy, /authMode\(\) !== "clerk"/);
  assert.match(proxy, /NextResponse\.next\(\)/);
  assert.match(proxy, /assertSafeAuthEnvironment\(\);\s*return clerkProxy/);
  assert.doesNotMatch(proxy, /\.protect\(/);
  assert.match(layout, /requirePermission\("dashboard\.read"\)/);
  assert.match(authProvider, /authMode\(\) !== "clerk"/);
  assert.match(authProvider, /<ClerkProvider[\s\S]*proxyUrl=\{PUBLIC_ROUTES\.clerkProxy\}[\s\S]*signInUrl=\{PUBLIC_ROUTES\.signIn\}/);
  assert.match(authProvider, /assertSafeAuthEnvironment\(\)/);
});

test("Clerk identity requires an MFA-complete verified primary email and immutable subject", () => {
  assert.match(auth, /auth\(\{ treatPendingAsSignedOut: true \}\)/);
  assert.match(auth, /currentUser\(\{ treatPendingAsSignedOut: true \}\)/);
  assert.match(auth, /user\.twoFactorEnabled/);
  assert.match(auth, /user\.primaryEmailAddress/);
  assert.match(auth, /primaryEmail\.verification\?\.status !== "verified"/);
  assert.match(auth, /`clerk:\$\{userId\}`/);
  assert.match(auth, /WHERE u\.external_subject = \$\{identity\.subject\} AND u\.status = 'active'/);
  assert.doesNotMatch(auth, /WHERE u\.email = \$\{identity\.email\}/);
});

test("staff sign-in is catch-all, invite-only, and offers explicit sign-out", () => {
  assert.match(signIn, /<SignIn/);
  assert.match(signIn, /routing="path"/);
  assert.match(signIn, /path=\{PUBLIC_ROUTES\.signIn\}/);
  assert.match(signIn, /withSignUp=\{false\}/);
  assert.match(signIn, /treatPendingAsSignedOut: true/);
  assert.match(signIn, /<SignOutButton redirectUrl=\{PUBLIC_ROUTES\.signIn\}>/);
  assert.match(adminShell, /<SignOutButton redirectUrl=\{PUBLIC_ROUTES\.signIn\}>/);
  assert.doesNotMatch(adminShell, /UserButton|UserAvatar/);
  assert.match(avatar, /hashSeed\(seed\)/);
  assert.match(avatar, /role="img"/);
  assert.match(avatar, /aria-label=/);
});

test("seeded Clerk owner claim is isolated, exact, row-locked, and audited", () => {
  assert.match(auth, /withDatabaseRole\("identity"/);
  assert.match(auth, /claim_seeded_clerk_owner/);
  assert.match(databaseClient, /identity: "IDENTITY_DATABASE_URL"/);
  assert.match(databaseClient, /identity: "pixbrik_identity_runtime"/);
  assert.match(clerkIdentity, /migration 0006 must run directly as pixbrik_migrator/);
  assert.match(clerkIdentity, /pixbrik_identity_runtime must have no role memberships/);
  assert.match(clerkIdentity, /constant_owner_email constant text := 'sam@benisty\.ca'/);
  assert.match(clerkIdentity, /namespaced_subject := 'clerk:' \|\| clerk_user_id/);
  assert.match(clerkIdentity, /FOR UPDATE/);
  assert.match(clerkIdentity, /assigned_role\.key = 'owner'/);
  assert.match(clerkIdentity, /INSERT INTO pixbrik\.audit_event/);
  assert.match(clerkIdentity, /'identity\.owner_claimed'/);
  assert.match(clerkIdentity, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, pixbrik, pg_temp/);
  assert.match(clerkIdentity, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pixbrik FROM pixbrik_identity_runtime/);
  assert.match(clerkIdentity, /GRANT EXECUTE ON FUNCTION claim_seeded_clerk_owner[\s\S]*TO pixbrik_identity_runtime/);
  assert.doesNotMatch(clerkIdentity, /INSERT INTO pixbrik\.(?:app_user|user_role|role)/);
});

test("example environment contains placeholders, not live provider keys", () => {
  assert.match(envExample, /RESEND_API_KEY=\r?\n/);
  assert.match(envExample, /STRIPE_SECRET_KEY=\r?\n/);
  assert.match(envExample, /CLERK_SECRET_KEY=\r?\n/);
  assert.match(envExample, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\r?\n/);
  assert.doesNotMatch(envExample, /(?:sk|rk|re)_(?:live|test)_[A-Za-z0-9]{12,}/);
});

test("migration and runtime credentials are separate and migrations serialize", () => {
  assert.match(envExample, /ADMIN_DATABASE_URL=/);
  assert.match(envExample, /CUSTOMER_DATABASE_URL=/);
  assert.match(envExample, /IDENTITY_DATABASE_URL=/);
  assert.match(envExample, /SERVICE_DATABASE_URL=/);
  assert.match(envExample, /MIGRATION_DATABASE_URL=/);
  assert.match(migrationScript, /process\.env\.MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(migrationScript, /process\.env\.DATABASE_URL/);
  assert.match(databaseClient, /admin: "ADMIN_DATABASE_URL"/);
  assert.match(databaseClient, /customer: "CUSTOMER_DATABASE_URL"/);
  assert.match(databaseClient, /identity: "IDENTITY_DATABASE_URL"/);
  assert.match(databaseClient, /service: "SERVICE_DATABASE_URL"/);
  assert.match(migrationScript, /pg_advisory_xact_lock/);
  assert.doesNotMatch(migrationScript, /pg_advisory_unlock/);
});

test("database roles, not a writable staff setting, decide authorization", () => {
  assert.match(rowSecurity, /ALTER TABLE commerce_order FORCE ROW LEVEL SECURITY/);
  assert.match(rowSecurity, /ALTER TABLE build_version FORCE ROW LEVEL SECURITY/);
  assert.match(hardening, /session_user::text = 'pixbrik_admin_runtime'/);
  assert.match(hardening, /session_user::text = 'pixbrik_customer_runtime'/);
  assert.match(hardening, /session_user::text = 'pixbrik_service_runtime'/);
  assert.doesNotMatch(hardening.match(/CREATE OR REPLACE FUNCTION request_is_staff[\s\S]*?\$\$;/)?.[0] ?? "", /pixbrik\.is_staff/);
  assert.doesNotMatch(rowSecurity, /\bGRANT\s[^;]*\bDELETE\b/i);
  assert.match(databaseClient, /set_config\('pixbrik\.user_id',[\s\S]*true\)/);
  assert.doesNotMatch(databaseClient, /pixbrik\.is_staff/);
  assert.match(databaseClient, /current_user::text AS database_user, session_user::text AS session_user/);
  assert.match(databaseClient, /identity\.session_user !== expectedDatabaseUser\[role\]/);
  assert.match(hardening, /migration 0005 must run directly as pixbrik_migrator/);
  assert.match(hardening, /provision all four PixBrik database roles/);
  assert.match(hardening, /request_is_migrator_database_role/);
  assert.match(
    hardening,
    /GRANT EXECUTE ON FUNCTION[\s\S]*request_is_admin_database_role\(\)[\s\S]*TO pixbrik_migrator, pixbrik_admin_runtime, pixbrik_customer_runtime/
  );
});

test("legacy blanket grants are revoked and replacement grants are explicit", () => {
  assert.match(hardening, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pixbrik FROM pixbrik_runtime/);
  assert.match(hardening, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM pixbrik_runtime/);
  assert.match(hardening, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pixbrik FROM PUBLIC/);
  assert.doesNotMatch(hardening, /GRANT SELECT, INSERT, UPDATE ON ALL TABLES/i);
  assert.doesNotMatch(hardening, /GRANT SELECT ON ALL TABLES/i);
  assert.doesNotMatch(hardening, /\bGRANT\s[^;]*\bDELETE\b/i);
  assert.match(hardening, /GRANT UPDATE \(display_name, preferred_locale, preferred_currency\)/);
  assert.match(hardening, /stored_asset_customer_insert[\s\S]*status = 'pending_scan'/);
  assert.match(hardening, /GRANT INSERT \([\s\S]*owner_user_id, storage_provider, object_key/);
});

test("all domain tables are forced behind rebuilt fail-closed policies", () => {
  assert.match(hardening, /FROM pg_catalog\.pg_policies/);
  assert.match(hardening, /DROP POLICY %I ON pixbrik\.%I/);
  assert.match(hardening, /ALTER TABLE pixbrik\.%I FORCE ROW LEVEL SECURITY/);
  assert.match(hardening, /legal_document_customer_read/);
  assert.match(hardening, /status = 'effective'/);
  assert.match(hardening, /commerce_order_customer_read/);
  assert.match(hardening, /app_user_service_update[\s\S]*kind = 'customer'/);
  assert.doesNotMatch(
    hardening.match(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_service_runtime'\)[\s\S]*?END IF;/)?.[0] ?? "",
    /GRANT (?:INSERT|UPDATE)[^;]*\bkind\b/
  );
  assert.match(hardening, /build_version_service_update[\s\S]*status IN \('draft', 'processing', 'review', 'rejected'\)/);
  assert.match(hardening, /approved_by IS NULL AND approved_at IS NULL AND locked_at IS NULL/);
});

test("package dependency names are valid npm names", () => {
  assert.ok(packageJson.dependencies["@clerk/nextjs"]);
  assert.ok(packageJson.devDependencies["@types/node"]);
  assert.ok(packageJson.devDependencies["@types/react"]);
  assert.ok(packageJson.devDependencies["@types/react-dom"]);
  assert.equal(Object.keys(packageJson.devDependencies).some((name) => /[\\\r\n]/.test(name)), false);
});

test("operational ledgers are immutable and sensitive domains are row-secured", () => {
  assert.match(operations, /inventory_movement_no_mutation/);
  assert.match(operations, /analytics_page_view_no_mutation/);
  assert.match(operations, /final affiliate financial records are immutable/);
  assert.match(operations, /FORCE ROW LEVEL SECURITY/);
  assert.match(operations, /affiliate_commission_owner_read/);
  assert.match(operations, /REVOKE INSERT, UPDATE ON inventory_balance/);
  assert.doesNotMatch(operations, /\bGRANT\s[^;]*\bDELETE\b/i);
  assert.match(hardening, /SECURITY DEFINER[\s\S]*SET search_path = pixbrik, pg_temp/);
  assert.match(hardening, /REVOKE ALL ON FUNCTION apply_inventory_movement\(\) FROM PUBLIC/);
  assert.match(hardening, /NEW\.actor_user_id := CASE/);
  assert.doesNotMatch(
    hardening.match(/CREATE OR REPLACE FUNCTION apply_inventory_movement[\s\S]*?\$\$;/)?.[0] ?? "",
    /COALESCE\(NEW\.actor_user_id/
  );
  assert.match(hardening, /current_user::text = 'pixbrik_migrator'[\s\S]*session_user::text IN \('pixbrik_admin_runtime', 'pixbrik_service_runtime'\)/);
  for (const name of [
    "validate_active_build_version",
    "validate_order_item_build_version",
    "prevent_overlapping_shipping_rate",
    "enforce_coupon_redemption_limits"
  ]) {
    assert.match(hardening, new RegExp(`ALTER FUNCTION ${name}\\(\\) SET search_path TO pixbrik, pg_temp`));
  }
  assert.doesNotMatch(hardening, /DECLARE[^\n]*;\s*\nDECLARE\b/);
});
