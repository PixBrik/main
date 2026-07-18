export const CONTACT_LOCALES = ['en', 'fr', 'es', 'it', 'ar'] as const;
export type ContactLocale = (typeof CONTACT_LOCALES)[number];

export const CONTACT_NAME_MAX_LENGTH = 100;
export const CONTACT_EMAIL_MAX_LENGTH = 254;
export const CONTACT_ORDER_REFERENCE_MAX_LENGTH = 50;
export const CONTACT_MESSAGE_MIN_LENGTH = 20;
export const CONTACT_MESSAGE_MAX_LENGTH = 5_000;
/** Bump whenever any localized contact privacy notice wording changes. */
export const CONTACT_PRIVACY_NOTICE_VERSION = 'contact-support-privacy-2026-07-18-v1' as const;

const CONTACT_EMAIL_PATTERN = /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/;
const CONTACT_ORDER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,49}$/;
const CONTACT_BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const CONTACT_SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export const CONTACT_TOPICS = [
  'general',
  'order',
  'wrong-damaged',
  'billing',
  'partnership',
  'press',
  'privacy',
  'other',
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Public contact-form contract. No provider credentials belong in this object. */
export interface ContactFormSubmission {
  companyWebsite: string;
  email: string;
  formStartedAt: number;
  locale: ContactLocale;
  message: string;
  name: string;
  orderReference?: string;
  privacyNoticePresentedAt: number;
  privacyNoticeVersion: typeof CONTACT_PRIVACY_NOTICE_VERSION;
  submissionId: string;
  topic: ContactTopic;
}

export interface ContactFormResult {
  messageKey: 'contact.received';
  ok: true;
  submissionId: string;
}

export class ContactFormRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ContactFormRequestError';
  }
}

export function hasUnsafeContactBidiControl(value: string): boolean {
  return CONTACT_BIDI_CONTROL_PATTERN.test(value);
}

export function isValidContactName(value: string): boolean {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return Boolean(name) &&
    name.length <= CONTACT_NAME_MAX_LENGTH &&
    !CONTACT_SINGLE_LINE_CONTROL_PATTERN.test(name) &&
    !hasUnsafeContactBidiControl(name);
}

export function isValidContactEmail(value: string): boolean {
  const email = value.normalize('NFKC').trim();
  return email.length > 0 &&
    email.length <= CONTACT_EMAIL_MAX_LENGTH &&
    CONTACT_EMAIL_PATTERN.test(email) &&
    !hasUnsafeContactBidiControl(email);
}

export function isValidContactOrderReference(value: string): boolean {
  const reference = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return reference.length === 0 || (
    reference.length <= CONTACT_ORDER_REFERENCE_MAX_LENGTH &&
    CONTACT_ORDER_REFERENCE_PATTERN.test(reference) &&
    !hasUnsafeContactBidiControl(reference)
  );
}

/** Generate once per submission and reuse it when retrying the same message. */
export function createContactSubmissionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Older React Native runtimes may not expose Web Crypto. This identifier
    // deduplicates a form retry; it is not an authentication credential.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function responseError(body: unknown, status: number): ContactFormRequestError {
  if (body && typeof body === 'object') {
    const record = body as { code?: unknown; field?: unknown; message?: unknown };
    const code = typeof record.code === 'string' ? record.code : 'contact_failed';
    const field = typeof record.field === 'string' ? record.field : undefined;
    const message = typeof record.message === 'string' ? record.message : 'The message could not be sent.';
    return new ContactFormRequestError(message, status, code, field);
  }
  return new ContactFormRequestError('The message could not be sent.', status, 'contact_failed');
}

export type ContactRuntime = 'native' | 'web';

function inferredContactRuntime(): ContactRuntime {
  return typeof document === 'undefined' ? 'native' : 'web';
}

function appUrlFromEnvironment(): string | undefined {
  // Expo only inlines EXPO_PUBLIC_* variables when accessed with dot notation.
  return typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_APP_URL : undefined;
}

export function resolveContactEndpoint(options: {
  appUrl?: string;
  endpoint?: string;
  runtime: ContactRuntime;
}): string {
  if (options.endpoint) return options.endpoint;
  if (options.runtime === 'web') return '/api/contact';

  const configuredUrl = (options.appUrl ?? appUrlFromEnvironment())?.trim();
  if (!configuredUrl) {
    throw new ContactFormRequestError(
      'The contact service is not configured for this app.',
      0,
      'contact_not_configured',
    );
  }

  try {
    const url = new URL(configuredUrl);
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid app URL');
    }
    return new URL('/api/contact', url.origin).toString();
  } catch {
    throw new ContactFormRequestError(
      'The contact service is not configured for this app.',
      0,
      'contact_not_configured',
    );
  }
}

/**
 * Submit through PixBrik's serverless proxy. Keep `submissionId` unchanged if
 * the UI retries after a network error so Resend can suppress duplicates.
 */
export async function submitContactForm(
  submission: ContactFormSubmission,
  options: {
    appUrl?: string;
    endpoint?: string;
    fetchImpl?: typeof fetch;
    runtime?: ContactRuntime;
    signal?: AbortSignal;
  } = {},
): Promise<ContactFormResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = resolveContactEndpoint({
    appUrl: options.appUrl,
    endpoint: options.endpoint,
    runtime: options.runtime ?? inferredContactRuntime(),
  });
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      body: JSON.stringify(submission),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: options.signal,
    });
  } catch (error) {
    const aborted = (error as { name?: unknown } | null)?.name === 'AbortError';
    throw new ContactFormRequestError(
      aborted ? 'The contact request was cancelled.' : 'The contact service could not be reached.',
      0,
      aborted ? 'contact_aborted' : 'contact_network_error',
    );
  }
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status);
  if (
    !body ||
    typeof body !== 'object' ||
    (body as { ok?: unknown }).ok !== true ||
    (body as { messageKey?: unknown }).messageKey !== 'contact.received' ||
    (body as { submissionId?: unknown }).submissionId !== submission.submissionId
  ) {
    throw new ContactFormRequestError('The contact service returned an invalid response.', 502, 'invalid_response');
  }
  return body as ContactFormResult;
}
