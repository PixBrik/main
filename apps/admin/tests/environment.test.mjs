import assert from "node:assert/strict";
import test from "node:test";

import { appOrigin, assertSafeAuthEnvironment, authMode, inspectEnvironment } from "../src/lib/env.ts";

test("environment inspection reports presence without returning values", () => {
  const secret = "do-not-render-this-value";
  const checks = inspectEnvironment({
    ADMIN_DATABASE_URL: secret,
    CUSTOMER_DATABASE_URL: secret,
    IDENTITY_DATABASE_URL: secret,
    SERVICE_DATABASE_URL: secret,
    STRIPE_SECRET_KEY: secret,
    AUTH_MODE: "trusted-gateway"
  });

  assert.equal(checks.find((check) => check.key === "ADMIN_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "CUSTOMER_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "IDENTITY_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "SERVICE_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "STRIPE_SECRET_KEY")?.configured, true);
  assert.equal(JSON.stringify(checks).includes(secret), false);
});

test("Clerk mode is launch-ready only when both dedicated instance keys exist", () => {
  const checks = inspectEnvironment({
    APP_URL: "https://www.pixbrik.com/backoffice",
    AUTH_MODE: "clerk",
    CLERK_SECRET_KEY: "staff-secret",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "staff-publishable"
  });

  assert.equal(checks.find((check) => check.key === "AUTH_MODE")?.configured, true);
  assert.equal(JSON.stringify(checks).includes("staff-secret"), false);
  assert.equal(JSON.stringify(checks).includes("staff-publishable"), false);
  assert.doesNotThrow(() => assertSafeAuthEnvironment({
    APP_URL: "https://www.pixbrik.com/backoffice",
    AUTH_MODE: "clerk",
    CLERK_SECRET_KEY: "staff-secret",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "staff-publishable"
  }));
  assert.throws(
    () => assertSafeAuthEnvironment({
      APP_URL: "https://www.pixbrik.com/backoffice",
      AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "staff-secret"
    }),
    /requires CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/
  );
  assert.throws(
    () => assertSafeAuthEnvironment({
      AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "staff-secret",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "staff-publishable"
    }),
    /requires APP_URL/
  );
});

test("APP_URL supplies one credential-free authorized-party origin", () => {
  assert.equal(appOrigin({ APP_URL: "https://www.pixbrik.com/backoffice" }), "https://www.pixbrik.com");
  assert.equal(appOrigin({ APP_URL: "http://localhost:3001/backoffice" }), "http://localhost:3001");
  assert.throws(() => appOrigin({ APP_URL: "javascript:alert(1)" }), /absolute HTTP\(S\)/);
  assert.throws(() => appOrigin({ APP_URL: "https://user:pass@example.com/backoffice" }), /without credentials/);
});

test("development authentication is rejected in production", () => {
  assert.throws(
    () => assertSafeAuthEnvironment({ NODE_ENV: "production", AUTH_MODE: "development" }),
    /forbidden in production/
  );
  assert.doesNotThrow(() => assertSafeAuthEnvironment({ NODE_ENV: "development", AUTH_MODE: "development" }));
});

test("disabled and malformed auth modes fail predictably", () => {
  assert.doesNotThrow(() => assertSafeAuthEnvironment({ AUTH_MODE: "disabled" }));
  assert.throws(
    () => assertSafeAuthEnvironment({ AUTH_MODE: "trusted-gateway" }),
    /requires AUTH_GATEWAY_SECRET/
  );
  assert.throws(() => authMode({ AUTH_MODE: "anything-goes" }), /Unsupported AUTH_MODE/);
});
