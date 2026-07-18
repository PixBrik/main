export type EnvironmentCheck = {
  key: string;
  label: string;
  configured: boolean;
  requiredForLaunch: boolean;
  group: "core" | "identity" | "payments" | "email" | "storage" | "fx" | "jobs";
};

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

export function inspectEnvironment(source: NodeJS.ProcessEnv = process.env): EnvironmentCheck[] {
  const authMode = readEnv("AUTH_MODE", source) ?? "disabled";
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
      key: "AUTH_MODE",
      label: "Production identity adapter",
      configured: authMode === "trusted-gateway" && nonEmpty(source.AUTH_GATEWAY_SECRET),
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
  const mode = readEnv("AUTH_MODE", source) ?? "disabled";
  if (source.NODE_ENV === "production" && mode === "development") {
    throw new Error("AUTH_MODE=development is forbidden in production");
  }
}
