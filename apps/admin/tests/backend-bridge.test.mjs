import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedBackendBridgeRequest } from "../src/lib/backend-bridge.ts";

const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGH0123456789_-";
const env = {
  CUSTOMER_APP_URL: "https://www.pixbrik.com",
  PIXBRIK_BACKEND_SHARED_SECRET: secret
};

function request({ origin = "https://www.pixbrik.com", token = secret } = {}) {
  return new Request("https://pixbrik-backoffice.vercel.app/backoffice/api/internal/readiness", {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-PixBrik-Customer-Origin": origin
    }
  });
}

test("backend bridge requires the shared secret and exact customer origin", () => {
  assert.equal(isAuthorizedBackendBridgeRequest(request(), env), true);
  assert.equal(
    isAuthorizedBackendBridgeRequest(request({ token: `${secret}x` }), env),
    false
  );
  assert.equal(
    isAuthorizedBackendBridgeRequest(request({ origin: "https://attacker.example" }), env),
    false
  );
});
test("backend bridge fails closed when either environment boundary is unsafe", () => {
  assert.equal(isAuthorizedBackendBridgeRequest(request(), {}), false);
  assert.equal(
    isAuthorizedBackendBridgeRequest(request(), {
      ...env,
      CUSTOMER_APP_URL: "https://www.pixbrik.com/backoffice"
    }),
    false
  );
  assert.equal(
    isAuthorizedBackendBridgeRequest(request(), {
      ...env,
      PIXBRIK_BACKEND_SHARED_SECRET: "too-short"
    }),
    false
  );
});
