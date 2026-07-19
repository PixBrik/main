import { timingSafeEqual } from "node:crypto";

const SHARED_SECRET_ENV = "PIXBRIK_BACKEND_SHARED_SECRET";
const CUSTOMER_APP_ENV = "CUSTOMER_APP_URL";
const MINIMUM_SECRET_BYTES = 32;

function environmentValue(
  name: string,
  source: NodeJS.ProcessEnv = process.env
): string | undefined {
  const value = source[name]?.trim();
  return value || undefined;
}
function configuredCustomerOrigin(source: NodeJS.ProcessEnv): string | null {
  const configured = environmentValue(CUSTOMER_APP_ENV, source);
  if (!configured) return null;

  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function configuredSharedSecret(source: NodeJS.ProcessEnv): string | null {
  const secret = environmentValue(SHARED_SECRET_ENV, source);
  return secret && Buffer.byteLength(secret, "utf8") >= MINIMUM_SECRET_BYTES
    ? secret
    : null;
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

function secretsMatch(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

/**
 * Authorizes only the server-side bridge hosted by the customer application.
 * Browser requests never receive or submit the shared secret.
 */
export function isAuthorizedBackendBridgeRequest(
  request: Request,
  source: NodeJS.ProcessEnv = process.env
): boolean {
  const expectedSecret = configuredSharedSecret(source);
  const suppliedSecret = bearerToken(request);
  const expectedOrigin = configuredCustomerOrigin(source);
  const suppliedOrigin = request.headers.get("x-pixbrik-customer-origin")?.trim();

  return Boolean(
    expectedSecret
    && suppliedSecret
    && expectedOrigin
    && suppliedOrigin === expectedOrigin
    && secretsMatch(suppliedSecret, expectedSecret)
  );
}
