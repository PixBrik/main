import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const session = await readFile(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
const passwordSession = await readFile(
  new URL("../src/lib/auth/password-session.ts", import.meta.url),
  "utf8"
);
const requestSecurity = await readFile(
  new URL("../src/lib/auth/request-security.ts", import.meta.url),
  "utf8"
);
const changePasswordPage = await readFile(
  new URL("../src/app/change-password/page.tsx", import.meta.url),
  "utf8"
);
const changePasswordAction = await readFile(
  new URL("../src/app/change-password/actions.ts", import.meta.url),
  "utf8"
);

test("temporary-password sessions are centrally restricted to the change-password flow", () => {
  assert.match(
    session,
    /principal\.mustChangePassword && !allowForcedPasswordChange[\s\S]*redirect\(APP_ROUTES\.changePassword\)/
  );
  assert.match(session, /requirePrincipalWithForcedChangeAccess\(false\)/);
  assert.match(session, /requirePrincipalWithForcedChangeAccess\(true\)/);
  assert.match(changePasswordPage, /requirePasswordChangePrincipal\(\)/);
  assert.match(changePasswordAction, /requirePasswordChangePrincipal\(\)/);
  assert.equal(
    (session.match(/requirePasswordChangePrincipal/g) ?? []).length,
    1,
    "the forced-change escape hatch should have one narrow definition"
  );
});

test("password sessions use opaque strict cookies and store only a keyed digest", () => {
  assert.match(passwordSession, /__Host-pixbrik_admin_session/);
  assert.match(passwordSession, /LEGACY_PRODUCTION_SESSION_COOKIE = "__Secure-pixbrik_admin_session"/);
  assert.match(passwordSession, /httpOnly: true/);
  assert.match(passwordSession, /sameSite: "strict"/);
  assert.match(passwordSession, /process\.env\.NODE_ENV === "production" \? "\/" : ADMIN_BASE_PATH/);
  assert.match(passwordSession, /\{ name: PRODUCTION_SESSION_COOKIE, path: "\/", secure: true \}/);
  const cookieSetter = passwordSession.slice(
    passwordSession.indexOf("async function setSessionCookie"),
    passwordSession.indexOf("export async function clearPasswordSessionCookie")
  );
  assert.doesNotMatch(cookieSetter, /domain\s*:/i, "the __Host cookie must remain host-only");
  assert.match(passwordSession, /digestSessionToken\(token\)/);
  assert.doesNotMatch(passwordSession, /INSERT[\s\S]{0,200}token[^_](?!digest)/i);
});

test("sign-in equalizes cold credential lookup and distinguishes outages from rejection", async () => {
  const signInAction = await readFile(
    new URL("../src/app/sign-in/actions.ts", import.meta.url),
    "utf8"
  );
  const throttleIndex = passwordSession.indexOf("await checkIpThrottle(context)");
  const prewarmIndex = passwordSession.indexOf("await prepareDummyPasswordVerification()");
  const lookupIndex = passwordSession.indexOf("local_auth_lookup_credential");

  assert.ok(throttleIndex >= 0 && throttleIndex < prewarmIndex && prewarmIndex < lookupIndex);
  assert.match(passwordSession, /code === "28000"[\s\S]*code === "40001"/);
  assert.match(passwordSession, /audit_event_local_auth_request_once/);
  assert.match(passwordSession, /recordCredentialFailure[\s\S]*isSignInRejection\(error\)/);
  assert.match(passwordSession, /sessionPasswordVersion !== expectedPasswordVersion \+ 1n/);
  assert.match(
    passwordSession,
    /local_auth_create_session\([\s\S]*\$\{sessionPasswordVersion\.toString\(\)\}::bigint/
  );
  assert.match(signInAction, /Sign-in is temporarily unavailable\. Please try again shortly\./);
  assert.match(signInAction, /error\.code === "invalid_credentials" \|\| error\.code === "invalid_input"/);
  assert.match(signInAction, /\^\[A-Za-z0-9_\.\-\]\{1,32\}\$/);
  assert.doesNotMatch(signInAction, /console\.error\([^)]*error\s*\)/);
});

test("database session resolution failures are not converted into anonymous sessions", () => {
  const resolutionStart = passwordSession.indexOf("export async function resolvePasswordPrincipal");
  const resolutionEnd = passwordSession.indexOf("async function recordReauthenticationFailure");
  const resolution = passwordSession.slice(resolutionStart, resolutionEnd);

  assert.match(resolution, /local_auth_resolve_session/);
  assert.doesNotMatch(resolution, /local_auth_resolve_session[\s\S]*catch/);
});

test("step-up failures are counted and admin resets compare the displayed password version", () => {
  assert.match(passwordSession, /local_auth_record_reauth_failure/);
  assert.match(passwordSession, /session_revoked/);
  assert.match(passwordSession, /passwordVersion: asNonNegativeBigInt\(row\.password_version\)\.toString\(\)/);
  assert.match(
    passwordSession,
    /local_staff_reset_password\([\s\S]*\$\{targetUserId\}::uuid,[\s\S]*\$\{passwordVersion\}::bigint/
  );
  assert.match(passwordSession, /Password changed in another session\. Refresh and try again\./);
});

test("every password mutation requires the exact configured browser origin", () => {
  assert.match(requestSecurity, /parsedOrigin !== trustedOrigin/);
  assert.match(requestSecurity, /fetchSite !== "same-origin"/);
  assert.match(requestSecurity, /digestPrivateMetadata\("client-ip"/);
  assert.match(requestSecurity, /digestPrivateMetadata\("user-agent"/);
});
