import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeAuthEnvironment, inspectEnvironment } from "../src/lib/env.ts";

test("environment inspection reports presence without returning values", () => {
  const secret = "do-not-render-this-value";
  const checks = inspectEnvironment({
    ADMIN_DATABASE_URL: secret,
    CUSTOMER_DATABASE_URL: secret,
    SERVICE_DATABASE_URL: secret,
    STRIPE_SECRET_KEY: secret,
    AUTH_MODE: "trusted-gateway"
  });

  assert.equal(checks.find((check) => check.key === "ADMIN_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "CUSTOMER_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "SERVICE_DATABASE_URL")?.configured, true);
  assert.equal(checks.find((check) => check.key === "STRIPE_SECRET_KEY")?.configured, true);
  assert.equal(JSON.stringify(checks).includes(secret), false);
});

test("development authentication is rejected in production", () => {
  assert.throws(
    () => assertSafeAuthEnvironment({ NODE_ENV: "production", AUTH_MODE: "development" }),
    /forbidden in production/
  );
  assert.doesNotThrow(() => assertSafeAuthEnvironment({ NODE_ENV: "development", AUTH_MODE: "development" }));
});
