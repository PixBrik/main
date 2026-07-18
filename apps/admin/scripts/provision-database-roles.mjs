import { randomBytes } from "node:crypto";

import postgres from "postgres";

const REQUIRED_ROLES = [
  "pixbrik_migrator",
  "pixbrik_admin_runtime",
  "pixbrik_customer_runtime",
  "pixbrik_identity_runtime",
  "pixbrik_service_runtime"
];
const RUNTIME_ROLE_VARIABLES = Object.freeze({
  pixbrik_admin_runtime: "ADMIN_DATABASE_URL",
  pixbrik_customer_runtime: "CUSTOMER_DATABASE_URL",
  pixbrik_identity_runtime: "IDENTITY_DATABASE_URL",
  pixbrik_service_runtime: "SERVICE_DATABASE_URL"
});
const MODE = process.argv[2];

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function assertClipboardOutputApproved() {
  if (process.env.CONFIRM_PROVISIONING_BUNDLE_OUTPUT !== "clipboard") {
    throw new Error(
      "Set CONFIRM_PROVISIONING_BUNDLE_OUTPUT=clipboard and capture stdout; never print provisioning secrets"
    );
  }
  if (process.env.CI && process.env.ALLOW_CI_DATABASE_PROVISIONING !== "1") {
    throw new Error("Database provisioning must run from a controlled shell, not CI");
  }
}

function canonicalRandomSecret(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) {
    throw new Error(`${label} must contain exactly 32 random bytes`);
  }
  return value;
}

function versionedSecret(value, label) {
  const match = typeof value === "string" ? /^v1:([A-Za-z0-9_-]+)$/.exec(value) : null;
  if (!match) throw new Error(`${label} must use the initial v1 secret format`);
  canonicalRandomSecret(match[1], label);
  return value;
}

function parseSecretBundle(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PROVISIONING_SECRETS_BUNDLE must contain the prepared JSON bundle");
  }
  if (parsed?.version !== 1 || typeof parsed.passwords !== "object" || parsed.passwords === null) {
    throw new Error("The provisioning secret bundle has an unsupported shape");
  }
  const passwordNames = Object.keys(parsed.passwords).sort();
  if (JSON.stringify(passwordNames) !== JSON.stringify([...REQUIRED_ROLES].sort())) {
    throw new Error("The provisioning secret bundle must contain exactly the five database roles");
  }
  const passwords = Object.fromEntries(
    REQUIRED_ROLES.map((role) => [role, canonicalRandomSecret(parsed.passwords[role], role)])
  );
  const passwordPepper = versionedSecret(parsed.passwordPepper, "password pepper");
  const sessionHmacKey = versionedSecret(parsed.sessionHmacKey, "session HMAC key");
  if (passwordPepper === sessionHmacKey) throw new Error("Authentication secrets must be different");
  return { version: 1, passwords, passwordPepper, sessionHmacKey };
}

function prepareSecretBundle() {
  return {
    version: 1,
    passwords: Object.fromEntries(REQUIRED_ROLES.map((role) => [role, randomSecret()])),
    passwordPepper: `v1:${randomSecret()}`,
    sessionHmacKey: `v1:${randomSecret()}`
  };
}

function readDirectNeonUrl() {
  const configured = process.env.PROVISIONING_DATABASE_URL?.trim();
  if (!configured) {
    throw new Error("PROVISIONING_DATABASE_URL is required and must use the Neon owner direct connection");
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("PROVISIONING_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!(["postgres:", "postgresql:"]).includes(parsed.protocol)) {
    throw new Error("PROVISIONING_DATABASE_URL must use postgres:// or postgresql://");
  }
  const labels = parsed.hostname.toLowerCase().split(".");
  if (
    labels.length < 3
    || !labels[0].startsWith("ep-")
    || labels[0].endsWith("-pooler")
    || labels.at(-2) !== "neon"
    || labels.at(-1) !== "tech"
  ) {
    throw new Error("PROVISIONING_DATABASE_URL must use a direct Neon endpoint, not a pooled endpoint");
  }
  if (!parsed.username || !parsed.password || parsed.pathname === "/") {
    throw new Error("PROVISIONING_DATABASE_URL must include owner credentials and a database name");
  }
  return parsed;
}

function pooledRuntimeBase(directUrl) {
  const pooled = new URL(directUrl);
  const labels = pooled.hostname.split(".");
  labels[0] = `${labels[0]}-pooler`;
  pooled.hostname = labels.join(".");
  return pooled;
}

function roleUrl(baseUrl, role, password) {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

function renderRuntimeEnvironment(directUrl, bundle) {
  const runtimeBase = pooledRuntimeBase(directUrl);
  return [
    "AUTH_MODE=password",
    "APP_URL=https://pixbrik-backoffice.vercel.app/backoffice",
    `AUTH_PASSWORD_PEPPER=${bundle.passwordPepper}`,
    `AUTH_SESSION_HMAC_KEY=${bundle.sessionHmacKey}`,
    ...Object.entries(RUNTIME_ROLE_VARIABLES).map(
      ([role, variable]) => `${variable}=${roleUrl(runtimeBase, role, bundle.passwords[role])}`
    )
  ].join("\n");
}

async function applyRoles(directUrl, bundle) {
  if (process.env.CONFIRM_DATABASE_PROVISIONING !== "pixbrik-backoffice") {
    throw new Error("Set CONFIRM_DATABASE_PROVISIONING=pixbrik-backoffice to provision the five isolated roles");
  }

  const sql = postgres(directUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    connection: { application_name: "pixbrik-role-provisioner" }
  });
  let provisioningError;
  try {
    await sql.begin(async (transaction) => {
      const [identity] = await transaction`
        SELECT
          current_user::text AS current_user,
          session_user::text AS session_user,
          current_database()::text AS database_name
      `;
      if (!identity || identity.current_user !== identity.session_user) {
        throw new Error("Provisioning must connect directly as the provider database owner");
      }

      const existing = await transaction`
        SELECT rolname
        FROM pg_catalog.pg_roles
        WHERE rolname = ANY(${REQUIRED_ROLES})
        ORDER BY rolname
      `;
      if (existing.length > 0) {
        throw new Error(
          `Refusing to rotate an existing PixBrik role: ${existing.map((row) => row.rolname).join(", ")}`
        );
      }

      const migrationTable = await transaction`
        SELECT pg_catalog.to_regclass('public.pixbrik_schema_migration')::text AS relation
      `;
      if (migrationTable[0]?.relation) {
        throw new Error("Refusing to provision roles in a database that already contains PixBrik migrations");
      }

      for (const role of REQUIRED_ROLES) {
        await transaction.unsafe(
          `CREATE ROLE ${role} LOGIN PASSWORD '${bundle.passwords[role]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
        );
      }

      await transaction`
        GRANT CONNECT, CREATE, TEMPORARY
        ON DATABASE ${transaction(identity.database_name)}
        TO pixbrik_migrator
      `;
      for (const role of REQUIRED_ROLES.slice(1)) {
        await transaction`
          GRANT CONNECT ON DATABASE ${transaction(identity.database_name)} TO ${transaction(role)}
        `;
      }
      await transaction`GRANT USAGE, CREATE ON SCHEMA public TO pixbrik_migrator`;
    });
  } catch (error) {
    provisioningError = error;
  }

  try {
    await sql.end({ timeout: 5 });
  } catch (error) {
    if (!provisioningError) provisioningError = error;
  }
  if (provisioningError) throw provisioningError;
}

async function main() {
  assertClipboardOutputApproved();
  if (MODE === "--prepare") {
    process.stdout.write(JSON.stringify(prepareSecretBundle()));
    return;
  }
  if (MODE !== "--apply" && MODE !== "--render") {
    throw new Error("Use --prepare, --apply, or --render through the controlled PowerShell workflow");
  }
  const directUrl = readDirectNeonUrl();
  const bundle = parseSecretBundle(process.env.PROVISIONING_SECRETS_BUNDLE ?? "");
  if (MODE === "--apply") await applyRoles(directUrl, bundle);
  process.stdout.write(`${renderRuntimeEnvironment(directUrl, bundle)}\n`);
}

await main();
