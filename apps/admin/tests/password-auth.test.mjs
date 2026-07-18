import assert from "node:assert/strict";
import test from "node:test";

import {
  ARGON2ID_HASH_PREFIX,
  HMAC_DIGEST_BYTES,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
  SESSION_TOKEN_RANDOM_BYTES,
  TEMPORARY_PASSWORD_RANDOM_BYTES,
  PasswordPolicyError,
  digestPrivateMetadata,
  digestSessionToken,
  evaluateStaffPasswordPolicy,
  generateOpaqueSessionToken,
  generateTemporaryPassword,
  hashStaffPassword,
  prepareDummyPasswordVerification,
  performDummyPasswordVerification,
  rehashVerifiedStaffPassword,
  verifyStaffPasswordDetailed,
  verifyStaffPassword
} from "../src/lib/auth/password.ts";

function versionedSecret(version, fill) {
  return `v${version}:${Buffer.alloc(32, fill).toString("base64url")}`;
}

const authEnvironment = {
  AUTH_PASSWORD_PEPPER: versionedSecret(1, 0x31),
  AUTH_SESSION_HMAC_KEY: versionedSecret(7, 0x72)
};

test("Argon2id hashes use the required parameters and pepper version", async () => {
  const password = "A long passphrase for PixBrik 🚀";
  const encoded = await hashStaffPassword(password, authEnvironment);

  assert.equal(encoded.pepperVersion, 1);
  assert.match(encoded.hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(encoded.hash.startsWith(ARGON2ID_HASH_PREFIX), true);
  assert.equal(
    await verifyStaffPassword(password, encoded.hash, encoded.pepperVersion, authEnvironment),
    true
  );
  assert.equal(
    await verifyStaffPassword("A different long passphrase", encoded.hash, encoded.pepperVersion, authEnvironment),
    false
  );
});

test("password verification fails closed with an unavailable pepper or version", async () => {
  const password = "Another secure PixBrik passphrase";
  const encoded = await hashStaffPassword(password, authEnvironment);
  const wrongPepper = {
    ...authEnvironment,
    AUTH_PASSWORD_PEPPER: versionedSecret(1, 0x41)
  };
  const wrongVersion = {
    ...authEnvironment,
    AUTH_PASSWORD_PEPPER: versionedSecret(2, 0x31)
  };

  assert.equal(
    await verifyStaffPassword(password, encoded.hash, encoded.pepperVersion, wrongPepper),
    false
  );
  assert.equal(
    await verifyStaffPassword(password, encoded.hash, encoded.pepperVersion, wrongVersion),
    false
  );
});

test("previous peppers verify through the bounded keyring and request a current rehash", async () => {
  const password = "A genuinely unusual old credential #47";
  const oldEnvironment = {
    ...authEnvironment,
    AUTH_PASSWORD_PEPPER: versionedSecret(1, 0x31)
  };
  const rotatedEnvironment = {
    ...authEnvironment,
    AUTH_PASSWORD_PEPPER: versionedSecret(2, 0x42),
    AUTH_PASSWORD_PEPPER_PREVIOUS: versionedSecret(1, 0x31)
  };
  const oldEncoded = await hashStaffPassword(password, oldEnvironment);

  assert.deepEqual(
    await verifyStaffPasswordDetailed(
      password,
      oldEncoded.hash,
      oldEncoded.pepperVersion,
      rotatedEnvironment
    ),
    { matches: true, needsRehash: true }
  );
  assert.equal(
    await verifyStaffPassword(password, oldEncoded.hash, oldEncoded.pepperVersion, rotatedEnvironment),
    true
  );

  const rehashed = await rehashVerifiedStaffPassword(password, rotatedEnvironment);
  assert.equal(rehashed.pepperVersion, 2);
  assert.deepEqual(
    await verifyStaffPasswordDetailed(
      password,
      rehashed.hash,
      rehashed.pepperVersion,
      rotatedEnvironment
    ),
    { matches: true, needsRehash: false }
  );
});

test("password policy counts Unicode code points, blocks common choices, and never trims", async () => {
  assert.equal(evaluateStaffPasswordPolicy("a".repeat(PASSWORD_MIN_CODE_POINTS - 1)).valid, false);
  assert.equal(evaluateStaffPasswordPolicy("G7!mQ2@vL9#xR4p").valid, true);

  const unicodeMaximum = Array.from(
    { length: PASSWORD_MAX_CODE_POINTS },
    (_, index) => String.fromCodePoint(0x1000 + index)
  ).join("");
  assert.equal(evaluateStaffPasswordPolicy(unicodeMaximum).codePointLength, PASSWORD_MAX_CODE_POINTS);
  assert.equal(
    evaluateStaffPasswordPolicy(`${unicodeMaximum}x`).violations.includes("too_long"),
    true
  );

  const common = evaluateStaffPasswordPolicy("Password Password!!!");
  assert.equal(common.violations.includes("common_password"), true);
  assert.equal(
    evaluateStaffPasswordPolicy("1234567890123456").violations.includes("common_password"),
    true
  );
  assert.equal(
    evaluateStaffPasswordPolicy("Password1234567").violations.includes("common_password"),
    true
  );
  await assert.rejects(
    () => hashStaffPassword("passwordpassword", authEnvironment),
    (error) => error instanceof PasswordPolicyError
      && error.violations.includes("common_password")
  );

  const spacedPassword = "  a safely spaced passphrase  ";
  const encoded = await hashStaffPassword(spacedPassword, authEnvironment);
  assert.equal(
    await verifyStaffPassword(spacedPassword, encoded.hash, encoded.pepperVersion, authEnvironment),
    true
  );
  assert.equal(
    await verifyStaffPassword(spacedPassword.trim(), encoded.hash, encoded.pepperVersion, authEnvironment),
    false
  );
});

test("password verification consistently applies NFC normalization", async () => {
  const decomposed = `Cafe\u0301 owner passphrase`;
  const composed = "Café owner passphrase";
  const encoded = await hashStaffPassword(decomposed, authEnvironment);

  assert.equal(
    await verifyStaffPassword(composed, encoded.hash, encoded.pepperVersion, authEnvironment),
    true
  );
});

test("versioned secrets are mandatory, canonical, and exactly 256 bits", async () => {
  await assert.rejects(
    () => hashStaffPassword("A sufficiently long password", {}),
    /AUTH_PASSWORD_PEPPER/
  );
  await assert.rejects(
    () => hashStaffPassword("A sufficiently long password", {
      AUTH_PASSWORD_PEPPER: `v1:${Buffer.alloc(16).toString("base64url")}`
    }),
    /32-byte key/
  );
  assert.throws(
    () => digestSessionToken(generateOpaqueSessionToken(), {
      AUTH_SESSION_HMAC_KEY: `${versionedSecret(1, 0x55)} `
    }),
    /whitespace/
  );
  await assert.rejects(
    () => prepareDummyPasswordVerification({
      AUTH_PASSWORD_PEPPER: versionedSecret(2, 0x55),
      AUTH_PASSWORD_PEPPER_PREVIOUS: versionedSecret(2, 0x56)
    }),
    /lower than the current pepper version/
  );
  await assert.rejects(
    () => prepareDummyPasswordVerification({
      AUTH_PASSWORD_PEPPER: versionedSecret(2, 0x55),
      AUTH_PASSWORD_PEPPER_PREVIOUS: versionedSecret(1, 0x55)
    }),
    /must not reuse key material/
  );
});

test("dummy password verification executes without accepting an identity", async () => {
  await assert.doesNotReject(
    () => prepareDummyPasswordVerification(authEnvironment)
  );
  await assert.doesNotReject(
    () => performDummyPasswordVerification("attacker supplied value", authEnvironment)
  );
  await assert.doesNotReject(
    () => performDummyPasswordVerification("x".repeat(PASSWORD_MAX_CODE_POINTS + 100), authEnvironment)
  );
});

test("verified grandfathered passwords can be rehashed without reapplying creation policy", async () => {
  const grandfatheredPassword = "Password1234567";
  assert.equal(evaluateStaffPasswordPolicy(grandfatheredPassword).valid, false);

  const encoded = await rehashVerifiedStaffPassword(grandfatheredPassword, authEnvironment);
  assert.equal(
    await verifyStaffPassword(
      grandfatheredPassword,
      encoded.hash,
      encoded.pepperVersion,
      authEnvironment
    ),
    true
  );
});

test("temporary passwords are policy-valid, random, and at least 24 characters", () => {
  const generated = new Set();
  for (let index = 0; index < 64; index += 1) {
    const password = generateTemporaryPassword();
    generated.add(password);
    assert.match(password, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(password, "base64url").byteLength, TEMPORARY_PASSWORD_RANDOM_BYTES);
    assert.ok(password.length >= 24);
    assert.equal(evaluateStaffPasswordPolicy(password).valid, true);
  }
  assert.equal(generated.size, 64);
});

test("opaque session tokens contain 256 bits of randomness and are unique", () => {
  const generated = new Set();
  for (let index = 0; index < 64; index += 1) {
    const token = generateOpaqueSessionToken();
    generated.add(token);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").byteLength, SESSION_TOKEN_RANDOM_BYTES);
  }
  assert.equal(generated.size, 64);
});

test("session and private-metadata HMACs are deterministic and domain separated", () => {
  const token = generateOpaqueSessionToken();
  const first = digestSessionToken(token, authEnvironment);
  const second = digestSessionToken(token, authEnvironment);
  const otherKey = digestSessionToken(token, {
    ...authEnvironment,
    AUTH_SESSION_HMAC_KEY: versionedSecret(8, 0x73)
  });
  const firstIp = digestPrivateMetadata("client-ip", "203.0.113.7", authEnvironment);
  const secondIp = digestPrivateMetadata("client-ip", "203.0.113.7", authEnvironment);
  const userAgent = digestPrivateMetadata("user-agent", "203.0.113.7", authEnvironment);

  assert.deepEqual(first, second);
  assert.equal(first.keyVersion, 7);
  assert.equal(Buffer.from(first.digest, "base64url").byteLength, HMAC_DIGEST_BYTES);
  assert.notEqual(first.digest, otherKey.digest);
  assert.deepEqual(firstIp, secondIp);
  assert.notEqual(firstIp.digest, userAgent.digest);
  assert.notEqual(first.digest, firstIp.digest);
});

test("session digests reject malformed or non-canonical tokens", () => {
  assert.throws(
    () => digestSessionToken("not-a-256-bit-token", authEnvironment),
    /canonical 256-bit/
  );
  assert.throws(
    () => digestPrivateMetadata("Client IP", "203.0.113.7", authEnvironment),
    /lowercase domain label/
  );
});
