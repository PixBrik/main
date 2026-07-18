export type EnvironmentCheck = {
  key: string;
  label: string;
  configured: boolean;
  requiredForLaunch: boolean;
  group: "core" | "identity" | "payments" | "email" | "storage" | "fx" | "jobs";
};

export const AUTH_MODES = ["disabled", "development", "trusted-gateway", "clerk"] as const;
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
          && nonEmpty(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)),
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
  if (mode === "trusted-gateway" && !nonEmpty(source.AUTH_GATEWAY_SECRET)) {
    throw new Error("AUTH_MODE=trusted-gateway requires AUTH_GATEWAY_SECRET");
  }
}
