import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../migrations/0007_local_staff_auth.sql", import.meta.url),
  "utf8"
);
const bootstrap = await readFile(
  new URL("../scripts/bootstrap-local-owner.mjs", import.meta.url),
  "utf8"
);

function functionDefinition(name) {
  const match = migration.match(
    new RegExp(`CREATE FUNCTION ${name}\\([\\s\\S]*?\\$function\\$;`)
  );
  assert.ok(match, `missing SQL function ${name}`);
  return match[0];
}

test("local staff credentials and opaque sessions have versioned revocation state", () => {
  assert.match(migration, /CREATE TABLE staff_credential \(/);
  assert.match(migration, /password_hash text/);
  assert.match(migration, /password_pepper_version integer/);
  assert.match(migration, /password_version bigint NOT NULL/);
  assert.match(migration, /session_generation bigint NOT NULL/);
  assert.match(migration, /must_change_password boolean NOT NULL/);
  assert.match(migration, /temporary_password_expires_at timestamptz/);
  assert.match(migration, /failed_login_count smallint NOT NULL/);
  assert.match(migration, /failure_window_started_at timestamptz/);
  assert.match(migration, /is_primary_owner boolean NOT NULL/);
  assert.match(migration, /CREATE TABLE staff_session \(/);
  assert.match(migration, /token_digest text NOT NULL UNIQUE/);
  assert.match(migration, /token_key_version integer NOT NULL CHECK \(token_key_version > 0\)/);
  assert.match(migration, /token_digest ~ '\^\[A-Za-z0-9_-\]\{43\}\$'/);
  assert.match(migration, /staff_session_user_active_idx/);
  assert.match(migration, /staff_session_expiry_idx/);
  assert.match(migration, /reauthenticated_at timestamptz,/);
  assert.match(migration, /reauthentication_failed_count smallint NOT NULL DEFAULT 0/);
  assert.match(migration, /last_reauthentication_failed_at timestamptz/);
  assert.match(migration, /CHECK \(reauthenticated_at IS NULL OR reauthenticated_at >= authenticated_at\)/);
  assert.doesNotMatch(migration, /raw[_ ]session[_ ]token/i);
});

test("anonymous failures persist an IP-digest throttle without raw network data", () => {
  assert.match(migration, /CREATE TABLE staff_login_throttle \(/);
  assert.match(migration, /ip_digest text PRIMARY KEY/);
  assert.match(migration, /staff_login_throttle_locked_idx/);
  assert.match(migration, /ALTER TABLE staff_login_throttle FORCE ROW LEVEL SECURITY/);

  const checkThrottle = functionDefinition("local_auth_check_throttle");
  assert.match(checkThrottle, /WHERE throttle\.ip_digest = p_ip_digest/);

  const failure = functionDefinition("local_auth_record_failure");
  assert.match(failure, /ON CONFLICT \(ip_digest\) DO NOTHING/);
  assert.match(failure, /FOR UPDATE/);
  assert.match(failure, /next_ip_count >= 10/);
  assert.match(failure, /next_ip_count >= 20/);

  const createSession = functionDefinition("local_auth_create_session");
  assert.match(createSession, /staff_login_throttle throttle/);
  assert.match(createSession, /throttle\.locked_until > now_at/);
});

test("password verifier shape is pinned to the application Argon2id policy", () => {
  assert.match(migration, /\^\\\$argon2id\\\$v=19\\\$m=65536,t=3,p=1\\\$/);
  assert.match(migration, /password_pepper_version > 0/);
  assert.match(functionDefinition("local_assert_password_hash"), /invalid password verifier/);
});

test("identity runtime has execute-only access with forced row security", () => {
  assert.match(migration, /ALTER TABLE staff_credential FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE staff_session FORCE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON staff_credential, staff_session[\s\S]*FROM PUBLIC, pixbrik_identity_runtime/
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO pixbrik_identity_runtime/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]*staff_(?:credential|session)/i);
  assert.match(functionDefinition("local_assert_identity_caller"), /session_user::text <> 'pixbrik_identity_runtime'/);
});

test("legacy admin commerce access cannot mutate staff identity, RBAC, or reserved audits", () => {
  assert.match(migration, /DROP POLICY app_user_admin_access ON app_user/);
  assert.match(
    migration,
    /CREATE POLICY app_user_admin_customer_update[\s\S]*?kind = 'customer'[\s\S]*?kind = 'customer'/
  );
  for (const table of ["role", "permission", "user_role", "role_permission"]) {
    assert.match(migration, new RegExp(`DROP POLICY ${table}_admin_access ON ${table}`));
    assert.match(migration, new RegExp(`CREATE POLICY ${table}_admin_read ON ${table} FOR SELECT`));
  }
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*ON role, permission, user_role, role_permission[\s\S]*FROM pixbrik_admin_runtime/
  );
  assert.match(migration, /CREATE POLICY audit_event_reserved_local_actions[\s\S]*AS RESTRICTIVE FOR INSERT/);
  assert.match(migration, /'auth\.reauthentication_failed'/);
  assert.match(migration, /'auth\.password_pepper_upgraded'/);
});

test("all local auth and staff-management entry points are security definers", () => {
  for (const name of [
    "bootstrap_seeded_local_owner",
    "local_auth_lookup_credential",
    "local_auth_check_throttle",
    "local_auth_record_failure",
    "local_auth_create_session",
    "local_auth_upgrade_password_pepper",
    "local_auth_resolve_session",
    "local_auth_logout",
    "local_auth_read_current_password",
    "local_auth_record_reauth_failure",
    "local_auth_mark_reauthenticated",
    "local_auth_change_password",
    "local_staff_list",
    "local_staff_create",
    "local_staff_reset_password",
    "local_staff_suspend",
    "local_staff_restore",
    "local_staff_soft_remove",
    "local_staff_set_roles"
  ]) {
    const definition = functionDefinition(name);
    assert.match(definition, /SECURITY DEFINER/);
    assert.match(definition, /SET search_path = pg_catalog, pixbrik, pg_temp/);
  }
});

test("successful login and password change enforce CAS and session rotation", () => {
  const createSession = functionDefinition("local_auth_create_session");
  assert.match(createSession, /credential\.password_version <> p_expected_password_version/);
  assert.match(createSession, /credential\.locked_until IS NOT NULL/);
  assert.match(createSession, /temporary_password_expires_at <= now_at/);
  assert.match(createSession, /now_at \+ interval '30 minutes'/);
  assert.match(createSession, /now_at \+ interval '12 hours'/);
  assert.match(
    createSession,
    /credential\.session_generation,[\s\S]*?now_at,[\s\S]*?NULL,[\s\S]*?now_at/
  );

  const changePassword = functionDefinition("local_auth_change_password");
  assert.match(changePassword, /password_version = next_password_version/);
  assert.match(changePassword, /session_generation = next_session_generation/);
  assert.match(changePassword, /revoke_reason = 'password_changed'/);
  assert.match(changePassword, /INSERT INTO pixbrik\.staff_session/);
  assert.match(changePassword, /must_change_password = false/);
  assert.match(changePassword, /temporary_password_expires_at = NULL/);
});

test("successful old-pepper login upgrades by CAS without dropping existing sessions", () => {
  const upgrade = functionDefinition("local_auth_upgrade_password_pepper");
  assert.match(upgrade, /credential\.password_version <> p_expected_password_version/);
  assert.match(upgrade, /p_new_password_pepper_version <= credential\.password_pepper_version/);
  assert.match(upgrade, /password_version = next_password_version/);
  assert.match(upgrade, /UPDATE pixbrik\.staff_session session[\s\S]*SET password_version = next_password_version/);
  assert.match(upgrade, /session\.revoked_at IS NULL/);
  assert.doesNotMatch(upgrade, /session_generation\s*=\s*credential\.session_generation\s*\+/);
  assert.doesNotMatch(upgrade, /revoke_reason\s*=/);
  assert.match(upgrade, /'auth\.password_pepper_upgraded'/);
});

test("forced-change sessions receive no roles or permissions", () => {
  const resolve = functionDefinition("local_auth_resolve_session");
  assert.match(resolve, /IF matched\.must_change_password THEN/);
  assert.match(resolve, /roles := '\{\}'::text\[\]/);
  assert.match(resolve, /permissions := '\{\}'::text\[\]/);
});

test("staff mutations require staff.manage and recent reauthentication", () => {
  for (const name of [
    "local_staff_create",
    "local_staff_reset_password",
    "local_staff_suspend",
    "local_staff_restore",
    "local_staff_soft_remove",
    "local_staff_set_roles"
  ]) {
    const definition = functionDefinition(name);
    assert.match(definition, /local_require_session\([\s\S]*?'staff\.manage',[\s\S]*?false,[\s\S]*?true/);
  }

  const requireSession = functionDefinition("local_require_session");
  assert.match(requireSession, /now_at timestamptz := pg_catalog\.clock_timestamp\(\)/);
  assert.match(requireSession, /session\.reauthenticated_at >= now_at - interval '10 minutes'/);
  const markReauthenticated = functionDefinition("local_auth_mark_reauthenticated");
  assert.match(markReauthenticated, /actor\.actor_password_version <> p_expected_password_version/);
  assert.match(markReauthenticated, /SET\s+reauthenticated_at = now_at/);
  assert.match(markReauthenticated, /reauthentication_failed_count = 0/);
  assert.match(markReauthenticated, /last_reauthentication_failed_at = NULL/);
});

test("management serialization precedes actor and target locks and wall-clock revalidation precedes mutation", () => {
  const firstMutations = {
    local_staff_create: "INSERT INTO pixbrik.app_user",
    local_staff_reset_password: "UPDATE pixbrik.staff_credential",
    local_staff_suspend: "UPDATE pixbrik.app_user",
    local_staff_restore: "UPDATE pixbrik.app_user",
    local_staff_soft_remove: "UPDATE pixbrik.app_user",
    local_staff_set_roles: "UPDATE pixbrik.user_role"
  };

  for (const [name, mutation] of Object.entries(firstMutations)) {
    const definition = functionDefinition(name);
    const advisory = definition.indexOf("pg_advisory_xact_lock");
    const firstRequire = definition.indexOf("local_require_session");
    const lastRequire = definition.lastIndexOf("local_require_session");
    const targetLock = definition.indexOf("FOR UPDATE");
    const firstMutation = definition.indexOf(mutation);
    assert.ok(advisory >= 0 && advisory < firstRequire, `${name} must serialize before actor locking`);
    assert.ok(targetLock < 0 || advisory < targetLock, `${name} must serialize before target locking`);
    assert.ok(lastRequire > firstRequire, `${name} must revalidate the actor`);
    assert.ok(lastRequire < firstMutation, `${name} must revalidate before mutation`);
    assert.match(definition.slice(lastRequire, firstMutation), /clock_timestamp\(\)/);
  }
});

test("reauthentication failures are per-session, audited, and revoke at five", () => {
  const failure = functionDefinition("local_auth_record_reauth_failure");
  assert.match(failure, /active_session\.reauthentication_failed_count \+ 1/);
  assert.match(failure, /next_failed_count >= 5 THEN now_at/);
  assert.match(failure, /revoke_reason = CASE[\s\S]*'reauthentication_failures'/);
  assert.match(failure, /'auth\.reauthentication_failed'/);
  assert.match(failure, /'failure_limit', 5/);
});

test("login throttles have finite windows and a success cannot erase a shared IP bucket", () => {
  const failure = functionDefinition("local_auth_record_failure");
  assert.match(failure, /throttle\.locked_until IS NOT NULL AND throttle\.locked_until > now_at/);
  assert.match(failure, /next_ip_lock := throttle\.locked_until/);
  assert.match(failure, /credential\.failure_window_started_at <= now_at - interval '1 hour'/);
  assert.match(failure, /next_lock := credential\.locked_until/);

  const createSession = functionDefinition("local_auth_create_session");
  assert.doesNotMatch(createSession, /UPDATE pixbrik\.staff_login_throttle/);
  assert.match(createSession, /failure_window_started_at = NULL/);
});

test("staff listing counts only sessions resolvable for usable active accounts", () => {
  const list = functionDefinition("local_staff_list");
  assert.match(list, /password_version bigint/);
  assert.match(list, /account\.status = 'active'/);
  assert.match(list, /account\.deleted_at IS NULL/);
  assert.match(list, /credential\.password_hash IS NOT NULL/);
  assert.match(list, /credential\.temporary_password_expires_at > pg_catalog\.now\(\)/);
});

test("admin password reset uses optimistic password-version concurrency", () => {
  const reset = functionDefinition("local_staff_reset_password");
  assert.match(reset, /p_expected_password_version bigint/);
  assert.match(reset, /target_credential\.password_version <> p_expected_password_version/);
  assert.match(reset, /credential\.password_version = p_expected_password_version/);
  assert.match(reset, /ERRCODE = '40001'/);
});

test("self, primary-owner and last-owner changes fail closed", () => {
  assert.match(migration, /staff_credential_single_primary_owner_idx/);
  assert.match(migration, /staff_credential_primary_owner_guard/);
  assert.match(migration, /app_user_primary_owner_guard/);
  assert.match(migration, /user_role_owner_guard/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*pixbrik-local-staff-owners/);
  assert.match(migration, /at least one usable owner must remain/);
  assert.match(migration, /primary owner account is protected/);
  assert.match(migration, /primary owner role is protected/);

  for (const name of [
    "local_staff_reset_password",
    "local_staff_suspend",
    "local_staff_restore",
    "local_staff_soft_remove",
    "local_staff_set_roles"
  ]) {
    const definition = functionDefinition(name);
    assert.match(definition, /p_target_user_id = actor\.actor_user_id/);
    assert.match(definition, /target_credential\.is_primary_owner/);
  }
});

test("removing staff is soft, audited, and revokes every authority channel", () => {
  const remove = functionDefinition("local_staff_soft_remove");
  assert.match(remove, /status = 'deleted'/);
  assert.match(remove, /deleted_at = now_at/);
  assert.match(remove, /credential_status = 'retired'/);
  assert.match(remove, /password_hash = NULL/);
  assert.match(remove, /session_generation = credential\.session_generation \+ 1/);
  assert.match(remove, /UPDATE pixbrik\.user_role[\s\S]*SET expires_at = now_at/);
  assert.match(remove, /revoke_reason = 'staff_removed'/);
  assert.match(remove, /'staff\.removed'/);
  assert.doesNotMatch(remove, /DELETE FROM/);
});

test("seeded owner bootstrap is exact, one-time, forced-change and audited", () => {
  const ownerBootstrap = functionDefinition("bootstrap_seeded_local_owner");
  assert.match(ownerBootstrap, /account\.email = 'sam@benisty\.ca'/);
  assert.match(ownerBootstrap, /account\.status = 'invited'[\s\S]*account\.status = 'active'/);
  assert.match(ownerBootstrap, /account\.external_subject IS NULL[\s\S]*account\.external_subject ~ '\^clerk:user_/);
  assert.match(ownerBootstrap, /credential\.credential_status = 'pending'/);
  assert.match(ownerBootstrap, /FOR UPDATE OF account, credential/);
  assert.match(ownerBootstrap, /must_change_password = true/);
  assert.match(ownerBootstrap, /interval '24 hours'/);
  assert.match(ownerBootstrap, /'identity\.local_owner_bootstrapped'/);
  assert.match(ownerBootstrap, /NULL,[\s\S]*'identity-runtime:local-owner-bootstrap'/);
  assert.doesNotMatch(ownerBootstrap, /INSERT INTO pixbrik\.(?:app_user|user_role|role)/);
});

test("password mode safely closes the former Clerk claim path and protects owner bindings", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION claim_seeded_clerk_owner\(text, text, text, uuid\)[\s\S]*FROM pixbrik_identity_runtime/
  );
  assert.match(migration, /DROP POLICY app_user_clerk_owner_claim_update ON app_user/);
  const ownerGuard = functionDefinition("guard_primary_staff_user");
  assert.match(ownerGuard, /NEW\.external_subject IS DISTINCT FROM OLD\.external_subject/);
  assert.match(ownerGuard, /NEW\.email_verified_at IS DISTINCT FROM OLD\.email_verified_at/);
});

test("owner recovery is deployment-only, row-safe, and attributes the system actor", () => {
  const recovery = functionDefinition("recover_seeded_local_owner");
  assert.doesNotMatch(recovery, /SELECT stored_account, stored_credential/);
  assert.match(recovery, /SELECT stored_account\.\*[\s\S]*INTO account[\s\S]*FOR UPDATE/);
  assert.match(recovery, /SELECT stored_credential\.\*[\s\S]*INTO credential[\s\S]*FOR UPDATE/);
  assert.match(recovery, /session_user::text <> 'pixbrik_migrator'/);
  assert.match(recovery, /NULL,[\s\S]*'deployment:pixbrik_migrator'/);
  assert.match(recovery, /revoked_by = NULL/);
});

test("bootstrap script generates, hashes and prints the temporary password once", () => {
  assert.match(bootstrap, /IDENTITY_DATABASE_URL/);
  assert.match(bootstrap, /generateTemporaryPassword\(\)/);
  assert.match(bootstrap, /hashStaffPassword\(temporaryPassword\)/);
  assert.match(bootstrap, /bootstrap_seeded_local_owner/);
  assert.match(bootstrap, /shown once/);
  assert.equal((bootstrap.match(/\$\{temporaryPassword\}/g) ?? []).length, 1);
  assert.doesNotMatch(bootstrap, /console\.(?:log|error)/);
  assert.doesNotMatch(bootstrap, /password_hash|pepperVersion\}\n/);
});
