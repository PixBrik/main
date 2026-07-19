import "server-only";

import { Resend } from "resend";

import { appOrigin, readEnv, requireEnv } from "@/lib/env";

let resendClient: Resend | undefined;

export type EmailRuntimeStatus = Readonly<{
  ready: boolean;
  apiKey: boolean;
  webhookSecret: boolean;
  sender: boolean;
  replyTo: boolean;
  customerApp: boolean;
  publicEmailApp: boolean;
  cronSecret: boolean;
  operatorApproved: boolean;
}>;

function validMailbox(value: string | undefined): boolean {
  if (!value || /[\r\n\p{C}]/u.test(value) || value.length > 320) return false;
  const address = value.match(/<([^<>]+)>$/u)?.[1] ?? value;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address);
}

function safeMailbox(value: string, label: string): string {
  if (!validMailbox(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function getResendClient(): Resend {
  if (resendClient) return resendClient;
  const key = requireEnv("RESEND_API_KEY");
  if (!key.startsWith("re_") || key.length < 10) {
    throw new Error("RESEND_API_KEY is invalid");
  }
  resendClient = new Resend(key);
  return resendClient;
}

export function inspectEmailRuntime(source: NodeJS.ProcessEnv = process.env): EmailRuntimeStatus {
  const apiKeyValue = readEnv("RESEND_API_KEY", source);
  const webhookSecretValue = readEnv("RESEND_WEBHOOK_SECRET", source);
  const apiKey = Boolean(apiKeyValue?.startsWith("re_") && apiKeyValue.length >= 10);
  const webhookSecret = Boolean(webhookSecretValue?.startsWith("whsec_") && webhookSecretValue.length >= 12);
  const senderValue = readEnv("RESEND_FROM_EMAIL", source);
  const replyValue = readEnv("RESEND_REPLY_TO_EMAIL", source);
  const sender = validMailbox(senderValue);
  const replyTo = validMailbox(replyValue);
  const validHttpsUrl = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  };
  const customerApp = validHttpsUrl(readEnv("CUSTOMER_APP_URL", source));
  const publicEmailApp = validHttpsUrl(readEnv("PUBLIC_EMAIL_APP_URL", source));
  const cronSecret = (readEnv("CRON_SECRET", source)?.length ?? 0) >= 32;
  const operatorApproved = readEnv("EMAIL_DELIVERY_APPROVED", source) === "true";
  return {
    ready: apiKey && webhookSecret && sender && replyTo && customerApp && publicEmailApp && cronSecret && operatorApproved,
    apiKey,
    webhookSecret,
    sender,
    replyTo,
    customerApp,
    publicEmailApp,
    cronSecret,
    operatorApproved
  };
}

export function automationCapability(
  sourceEvent: string,
  source: NodeJS.ProcessEnv = process.env
): Readonly<{ ready: boolean; reason: string | null }> {
  if (["customer.created", "order.delivered"].includes(sourceEvent)) {
    const ready = readEnv("CUSTOMER_APP_EMAIL_LINKS_READY", source) === "true";
    return {
      ready,
      reason: ready ? null : "Locked until the storefront create/contact deep links are live and verified."
    };
  }
  if (sourceEvent === "checkout.abandoned") {
    const ready = readEnv("CHECKOUT_RECOVERY_EMAIL_READY", source) === "true";
    return {
      ready,
      reason: ready ? null : "Locked until the storefront persists carts and verifies exact resume links."
    };
  }
  if (["order.placed", "payment.failed", "order.shipped"].includes(sourceEvent)) {
    const ready = readEnv("CUSTOMER_PORTAL_EMAIL_LINKS_READY", source) === "true";
    return {
      ready,
      reason: ready ? null : "Locked until customer order and payment links are live and verified."
    };
  }
  return { ready: true, reason: null };
}

export function emailRuntimeConfiguration(): Readonly<{
  sendingConfigured: boolean;
  webhookConfigured: boolean;
  from: string;
  replyTo: string;
  customerAppOrigin: string;
}> {
  const from = requireEnv("RESEND_FROM_EMAIL");
  const replyTo = requireEnv("RESEND_REPLY_TO_EMAIL");
  const configuredApp = requireEnv("CUSTOMER_APP_URL");
  let customerAppOrigin: string;
  try {
    const parsed = new URL(configuredApp);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    customerAppOrigin = parsed.origin;
  } catch {
    throw new Error("CUSTOMER_APP_URL must be an HTTPS origin without credentials");
  }
  return {
    sendingConfigured: Boolean(readEnv("RESEND_API_KEY") && from && replyTo && configuredApp),
    webhookConfigured: Boolean(readEnv("RESEND_WEBHOOK_SECRET")),
    from: safeMailbox(from, "RESEND_FROM_EMAIL"),
    replyTo: safeMailbox(replyTo, "RESEND_REPLY_TO_EMAIL"),
    customerAppOrigin
  };
}

export function customerFacingUrl(pathOrUrl: string): string {
  if (/\p{C}|\\/u.test(pathOrUrl) || pathOrUrl.startsWith("//")) {
    throw new Error("Email CTA path is invalid");
  }
  const expected = emailRuntimeConfiguration().customerAppOrigin;
  if (/^https:\/\//i.test(pathOrUrl)) {
    const candidate = new URL(pathOrUrl);
    if (candidate.origin !== expected) throw new Error("Email CTA origin is not trusted");
    return candidate.toString();
  }
  if (!pathOrUrl.startsWith("/")) throw new Error("Email CTA path is invalid");
  const candidate = new URL(pathOrUrl, expected);
  if (candidate.origin !== expected) throw new Error("Email CTA origin is not trusted");
  return candidate.toString();
}

function publicEmailUrl(path: string, search?: Readonly<Record<string, string>>): string {
  const configured = readEnv("PUBLIC_EMAIL_APP_URL") ?? requireEnv("APP_URL");
  const base = new URL(configured);
  if (!(base.protocol === "https:" || (process.env.NODE_ENV !== "production" && base.protocol === "http:"))) {
    throw new Error("PUBLIC_EMAIL_APP_URL must use HTTPS in production");
  }
  if (base.username || base.password || !appOrigin({ ...process.env, APP_URL: configured })) {
    throw new Error("PUBLIC_EMAIL_APP_URL is invalid");
  }
  const pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  base.pathname = `${pathname}${path.replace(/^\//, "")}`;
  base.search = "";
  base.hash = "";
  for (const [key, value] of Object.entries(search ?? {})) base.searchParams.set(key, value);
  return base.toString();
}

export function unsubscribeUrls(token: string): Readonly<{ page: string; oneClick: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Unsubscribe token is invalid");
  return {
    page: publicEmailUrl(`unsubscribe/${token}`),
    oneClick: publicEmailUrl("api/unsubscribe", { token })
  };
}
