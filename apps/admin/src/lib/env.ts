export type EnvironmentCheck = {
  key: string;
  label: string;
  configured: boolean;
  requiredForLaunch: boolean;
  group: "core" | "identity" | "payments" | "email" | "storage" | "fx" | "jobs";
};

export const AUTH_MODES = ["disabled", "development", "trusted-gateway", "clerk", "password"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

const nonEmpty = (value: string | undefined): boolean => Boolean(value?.trim());

export function readEnv(name: string, source: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string, source: NodeJS.ProcessEnv = process.env): string {
  const value = readEnv(name, source);
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export function appOrigin(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = readEnv("APP_URL", source);
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP(S) URL");
  }

  if (!(["http:", "https:"] as string[]).includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("APP_URL must be an absolute HTTP(S) URL without credentials");
  }
  return parsed.origin;
}

function hasSafeAppOrigin(source: NodeJS.ProcessEnv): boolean {
  try {
    return Boolean(appOrigin(source));
  } catch {
    return false;
  }
}

function hasSafeCustomerAppOrigin(source: NodeJS.ProcessEnv): boolean {
  const configured = readEnv("CUSTOMER_APP_URL", source);
  if (!configured) return false;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return false;
  }
}

function hasBackendBridgeSecret(source: NodeJS.ProcessEnv): boolean {
  const secret = readEnv("PIXBRIK_BACKEND_SHARED_SECRET", source);
  return Boolean(
    secret
    && Buffer.byteLength(secret, "utf8") >= 32
    && /^[A-Za-z0-9_-]+$/.test(secret)
  );
}

type VersionedSecretMetadata = Readonly<{ version: number; key: Buffer }>;

function versionedSecretMetadata(value: string | undefined): VersionedSecretMetadata | undefined {
  const match = value?.match(/^v([1-9][0-9]*):([A-Za-z0-9_-]+)$/);
  if (!match) return undefined;
  const encoded = match[2];
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) return undefined;
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) return undefined;
    return { version, key: decoded };
  } catch {
    return undefined;
  }
}

function hasVersionedSecret(value: string | undefined): boolean {
  return Boolean(versionedSecretMetadata(value));
}

function passwordPepperKeyringIsSafe(source: NodeJS.ProcessEnv): boolean {
  const current = versionedSecretMetadata(source.AUTH_PASSWORD_PEPPER);
  const session = versionedSecretMetadata(source.AUTH_SESSION_HMAC_KEY);
  if (!current || !session || current.key.equals(session.key)) return false;

  const configured = source.AUTH_PASSWORD_PEPPER_PREVIOUS;
  if (!configured) return true;
  if (configured !== configured.trim()) return false;
  const entries = configured.split(",");
  if (entries.length < 1 || entries.length > 4 || entries.some((entry) => !entry)) return false;

  const seenVersions = new Set<number>([current.version]);
  const seenKeys = [current.key, session.key];
  for (const entry of entries) {
    const previous = versionedSecretMetadata(entry);
    if (
      !previous
      || previous.version >= current.version
      || seenVersions.has(previous.version)
      || seenKeys.some((key) => key.equals(previous.key))
    ) {
      return false;
    }
    seenVersions.add(previous.version);
    seenKeys.push(previous.key);
  }
  return true;
}

export function authMode(source: NodeJS.ProcessEnv = process.env): AuthMode {
  const mode = readEnv("AUTH_MODE", source) ?? "disabled";
  if (!AUTH_MODES.includes(mode as AuthMode)) {
    throw new Error(`Unsupported AUTH_MODE: ${mode}`);
  }
  return mode as AuthMode;
}

export function inspectEnvironment(source: NodeJS.ProcessEnv = process.env): EnvironmentCheck[] {
  const mode = authMode(source);
  return [
    {
      key: "ADMIN_DATABASE_URL",
      label: "Admin PostgreSQL role",
      configured: nonEmpty(source.ADMIN_DATABASE_URL),
      requiredForLaunch: true,
      group: "core"
    },
    {
      key: "CUSTOMER_DATABASE_URL",
      label: "Customer PostgreSQL role",
      configured: nonEmpty(source.CUSTOMER_DATABASE_URL),
      requiredForLaunch: true,
      group: "core"
    },
    {
      key: "SERVICE_DATABASE_URL",
      label: "Service PostgreSQL role",
      configured: nonEmpty(source.SERVICE_DATABASE_URL),
      requiredForLaunch: true,
      group: "core"
    },
    {
      key: "CUSTOMER_APP_URL",
      label: "Customer application origin",
      configured: hasSafeCustomerAppOrigin(source),
      requiredForLaunch: true,
      group: "core"
    },
    {
      key: "PIXBRIK_BACKEND_SHARED_SECRET",
      label: "Customer application backend bridge",
      configured: hasBackendBridgeSecret(source),
      requiredForLaunch: true,
      group: "core"
    },
    {
      key: "IDENTITY_DATABASE_URL",
      label: "Identity bootstrap PostgreSQL role",
      configured: nonEmpty(source.IDENTITY_DATABASE_URL),
      requiredForLaunch: true,
      group: "identity"
    },
    {
      key: "AUTH_MODE",
      label: "Production identity adapter",
      configured:
        (mode === "trusted-gateway" && nonEmpty(source.AUTH_GATEWAY_SECRET))
        || (mode === "clerk"
          && nonEmpty(source.CLERK_SECRET_KEY)
          && nonEmpty(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
          && hasSafeAppOrigin(source))
        || (mode === "password"
          && nonEmpty(source.IDENTITY_DATABASE_URL)
          && hasVersionedSecret(source.AUTH_PASSWORD_PEPPER)
          && hasVersionedSecret(source.AUTH_SESSION_HMAC_KEY)
          && passwordPepperKeyringIsSafe(source)
          && hasSafeAppOrigin(source)),
      requiredForLaunch: true,
      group: "identity"
    },
    {
      key: "STRIPE_SECRET_KEY",
      label: "Stripe server key",
      configured: nonEmpty(source.STRIPE_SECRET_KEY),
      requiredForLaunch: true,
      group: "payments"
    },
    {
      key: "STRIPE_WEBHOOK_SECRET",
      label: "Stripe webhook signature",
      configured: nonEmpty(source.STRIPE_WEBHOOK_SECRET),
      requiredForLaunch: true,
      group: "payments"
    },
    {
      key: "RESEND_API_KEY",
      label: "Resend sending key",
      configured: nonEmpty(source.RESEND_API_KEY),
      requiredForLaunch: true,
      group: "email"
    },
    {
      key: "RESEND_WEBHOOK_SECRET",
      label: "Resend webhook signature",
      configured: nonEmpty(source.RESEND_WEBHOOK_SECRET),
      requiredForLaunch: true,
      group: "email"
    },
    {
      key: "BLOB_READ_WRITE_TOKEN",
      label: "Private asset storage",
      configured: nonEmpty(source.BLOB_READ_WRITE_TOKEN),
      requiredForLaunch: true,
      group: "storage"
    },
    {
      key: "FX_PROVIDER_URL",
      label: "Daily EUR reference-rate source",
      configured: nonEmpty(source.FX_PROVIDER_URL),
      requiredForLaunch: true,
      group: "fx"
    },
    {
      key: "CRON_SECRET",
      label: "Scheduled job authentication",
      configured: nonEmpty(source.CRON_SECRET),
      requiredForLaunch: true,
      group: "jobs"
    }
  ];
}

export function assertSafeAuthEnvironment(source: NodeJS.ProcessEnv = process.env): void {
  const mode = authMode(source);
  if (source.NODE_ENV === "production" && mode === "development") {
    throw new Error("AUTH_MODE=development is forbidden in production");
  }
  if (
    mode === "clerk"
    && (!nonEmpty(source.CLERK_SECRET_KEY) || !nonEmpty(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY))
  ) {
    throw new Error(
      "AUTH_MODE=clerk requires CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
    );
  }
  if (mode === "clerk" && !appOrigin(source)) {
    throw new Error("AUTH_MODE=clerk requires APP_URL with the trusted admin origin");
  }
  if (mode === "trusted-gateway" && !nonEmpty(source.AUTH_GATEWAY_SECRET)) {
    throw new Error("AUTH_MODE=trusted-gateway requires AUTH_GATEWAY_SECRET");
  }
  if (mode === "password") {
    if (!nonEmpty(source.IDENTITY_DATABASE_URL)) {
      throw new Error("AUTH_MODE=password requires IDENTITY_DATABASE_URL");
    }
    if (!hasVersionedSecret(source.AUTH_PASSWORD_PEPPER)) {
      throw new Error("AUTH_MODE=password requires a versioned, canonical 32-byte base64url AUTH_PASSWORD_PEPPER");
    }
    if (!hasVersionedSecret(source.AUTH_SESSION_HMAC_KEY)) {
      throw new Error("AUTH_MODE=password requires a versioned, canonical 32-byte base64url AUTH_SESSION_HMAC_KEY");
    }
    if (!passwordPepperKeyringIsSafe(source)) {
      throw new Error(
        "Password pepper and session HMAC key material must be different; previous peppers must use unique lower versions (maximum four)"
      );
    }
    const origin = appOrigin(source);
    if (!origin) throw new Error("AUTH_MODE=password requires APP_URL");
    if (source.NODE_ENV === "production" && !origin.startsWith("https://")) {
      throw new Error("AUTH_MODE=password requires an HTTPS APP_URL in production");
    }
  }
}
