import { createHash } from 'node:crypto';

import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_LOCALES,
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_MESSAGE_MIN_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_ORDER_REFERENCE_MAX_LENGTH,
  CONTACT_PRIVACY_NOTICE_VERSION,
  CONTACT_TOPICS,
  hasUnsafeContactBidiControl,
  isValidContactEmail,
  isValidContactOrderReference,
  type ContactLocale,
  type ContactTopic,
} from '../src/lib/contactForm';

export const CONTACT_EMAIL_TIMEOUT_MS = 10_000;
export const CONTACT_MAX_BODY_BYTES = 16 * 1024;
export const CONTACT_MIN_FILL_TIME_MS = 1_500;
// Keep accepted retries inside Resend's 24-hour idempotency window.
export const CONTACT_MAX_FORM_AGE_MS = 23 * 60 * 60 * 1_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ContactSubmission {
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
  trapped: boolean;
}

export interface ContactEmailContent {
  html: string;
  subject: string;
  text: string;
}

export class ContactValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly code = 'invalid_contact_request',
  ) {
    super(message);
    this.name = 'ContactValidationError';
  }
}

export class ContactServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ContactServiceError';
  }
}

interface ContactCopy {
  eyebrow: string;
  intro: string;
  labels: {
    email: string;
    language: string;
    message: string;
    name: string;
    orderReference: string;
    privacyNotice: string;
    privacyNoticePresentedAt: string;
    topic: string;
  };
  title: string;
  topics: Record<ContactTopic, string>;
}

const COPY: Record<ContactLocale, ContactCopy> = {
  en: {
    eyebrow: 'CONTACT FORM',
    intro: 'A new message arrived from the PixBrik contact form.',
    labels: {
      email: 'Email',
      language: 'Language',
      message: 'Message',
      name: 'Name',
      orderReference: 'Order reference',
      privacyNotice: 'Privacy notice version',
      privacyNoticePresentedAt: 'Privacy notice presented at',
      topic: 'Topic',
    },
    title: 'New contact request',
    topics: {
      general: 'General question',
      order: 'Existing order',
      'wrong-damaged': 'Wrong or damaged order',
      billing: 'Billing or invoice',
      partnership: 'Partnership',
      press: 'Press',
      privacy: 'Privacy',
      other: 'Other',
    },
  },
  fr: {
    eyebrow: 'FORMULAIRE DE CONTACT',
    intro: 'Un nouveau message a été envoyé depuis le formulaire de contact PixBrik.',
    labels: {
      email: 'E-mail',
      language: 'Langue',
      message: 'Message',
      name: 'Nom',
      orderReference: 'Référence de commande',
      privacyNotice: 'Version de la notice de confidentialité',
      privacyNoticePresentedAt: 'Notice présentée le',
      topic: 'Objet',
    },
    title: 'Nouvelle demande de contact',
    topics: {
      general: 'Question générale',
      order: 'Commande existante',
      'wrong-damaged': 'Commande erronée ou endommagée',
      billing: 'Facturation ou facture',
      partnership: 'Partenariat',
      press: 'Presse',
      privacy: 'Vie privée',
      other: 'Autre',
    },
  },
  es: {
    eyebrow: 'FORMULARIO DE CONTACTO',
    intro: 'Ha llegado un nuevo mensaje desde el formulario de contacto de PixBrik.',
    labels: {
      email: 'Correo electrónico',
      language: 'Idioma',
      message: 'Mensaje',
      name: 'Nombre',
      orderReference: 'Referencia del pedido',
      privacyNotice: 'Versión del aviso de privacidad',
      privacyNoticePresentedAt: 'Aviso mostrado el',
      topic: 'Asunto',
    },
    title: 'Nueva solicitud de contacto',
    topics: {
      general: 'Consulta general',
      order: 'Pedido existente',
      'wrong-damaged': 'Pedido erróneo o dañado',
      billing: 'Facturación o factura',
      partnership: 'Colaboración',
      press: 'Prensa',
      privacy: 'Privacidad',
      other: 'Otro',
    },
  },
  it: {
    eyebrow: 'MODULO DI CONTATTO',
    intro: 'È arrivato un nuovo messaggio dal modulo di contatto PixBrik.',
    labels: {
      email: 'E-mail',
      language: 'Lingua',
      message: 'Messaggio',
      name: 'Nome',
      orderReference: 'Riferimento ordine',
      privacyNotice: 'Versione dell’informativa privacy',
      privacyNoticePresentedAt: 'Informativa mostrata il',
      topic: 'Argomento',
    },
    title: 'Nuova richiesta di contatto',
    topics: {
      general: 'Domanda generale',
      order: 'Ordine esistente',
      'wrong-damaged': 'Ordine errato o danneggiato',
      billing: 'Pagamento o fattura',
      partnership: 'Partnership',
      press: 'Stampa',
      privacy: 'Privacy',
      other: 'Altro',
    },
  },
  ar: {
    eyebrow: 'نموذج التواصل',
    intro: 'وصلت رسالة جديدة عبر نموذج التواصل في PixBrik.',
    labels: {
      email: 'البريد الإلكتروني',
      language: 'اللغة',
      message: 'الرسالة',
      name: 'الاسم',
      orderReference: 'مرجع الطلب',
      privacyNotice: 'إصدار إشعار الخصوصية',
      privacyNoticePresentedAt: 'وقت عرض إشعار الخصوصية',
      topic: 'الموضوع',
    },
    title: 'طلب تواصل جديد',
    topics: {
      general: 'استفسار عام',
      order: 'طلب حالي',
      'wrong-damaged': 'طلب خاطئ أو تالف',
      billing: 'الدفع أو الفاتورة',
      partnership: 'شراكة',
      press: 'الصحافة',
      privacy: 'الخصوصية',
      other: 'أخرى',
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanSingleLine(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ContactValidationError(`${field} is required.`, field);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    hasUnsafeContactBidiControl(normalized)
  ) {
    throw new ContactValidationError(`${field} is invalid.`, field);
  }
  return normalized;
}

function cleanMessage(value: unknown): string {
  if (typeof value !== 'string') throw new ContactValidationError('message is required.', 'message');
  const normalized = value.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
  if (
    normalized.length < CONTACT_MESSAGE_MIN_LENGTH ||
    normalized.length > CONTACT_MESSAGE_MAX_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) {
    throw new ContactValidationError('message is invalid.', 'message');
  }
  return normalized;
}

function normalizeLocale(value: unknown): ContactLocale {
  if (typeof value !== 'string') throw new ContactValidationError('locale is required.', 'locale');
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  if (!CONTACT_LOCALES.includes(base as ContactLocale)) {
    throw new ContactValidationError('locale is not supported.', 'locale');
  }
  return base as ContactLocale;
}

function normalizeTopic(value: unknown): ContactTopic {
  if (typeof value !== 'string' || !CONTACT_TOPICS.includes(value as ContactTopic)) {
    throw new ContactValidationError('topic is not supported.', 'topic');
  }
  return value as ContactTopic;
}

export function parseContactSubmission(value: unknown, now = Date.now()): ContactSubmission {
  if (!isRecord(value)) throw new ContactValidationError('A contact request is required.', 'form');

  const name = cleanSingleLine(value.name, 'name', CONTACT_NAME_MAX_LENGTH);
  const email = cleanSingleLine(value.email, 'email', CONTACT_EMAIL_MAX_LENGTH).toLowerCase();
  if (!isValidContactEmail(email)) throw new ContactValidationError('email is invalid.', 'email');
  const message = cleanMessage(value.message);
  const locale = normalizeLocale(value.locale);
  const topic = normalizeTopic(value.topic);

  if (value.privacyNoticeVersion !== CONTACT_PRIVACY_NOTICE_VERSION) {
    throw new ContactValidationError('privacyNoticeVersion is invalid.', 'privacyNoticeVersion');
  }
  if (typeof value.submissionId !== 'string' || !UUID_PATTERN.test(value.submissionId)) {
    throw new ContactValidationError('submissionId is invalid.', 'submissionId');
  }
  if (!Number.isSafeInteger(value.formStartedAt)) {
    throw new ContactValidationError('formStartedAt is invalid.', 'formStartedAt');
  }
  const formStartedAt = value.formStartedAt as number;
  const formAge = now - formStartedAt;
  if (formAge < -60_000 || formAge > CONTACT_MAX_FORM_AGE_MS) {
    throw new ContactValidationError('formStartedAt is outside the accepted window.', 'formStartedAt');
  }

  if (!Number.isSafeInteger(value.privacyNoticePresentedAt)) {
    throw new ContactValidationError('privacyNoticePresentedAt is invalid.', 'privacyNoticePresentedAt');
  }
  const privacyNoticePresentedAt = value.privacyNoticePresentedAt as number;
  const noticeAge = now - privacyNoticePresentedAt;
  if (
    noticeAge < -60_000 ||
    noticeAge > CONTACT_MAX_FORM_AGE_MS ||
    privacyNoticePresentedAt < formStartedAt - 60_000 ||
    privacyNoticePresentedAt > formStartedAt + 60_000
  ) {
    throw new ContactValidationError(
      'privacyNoticePresentedAt is outside the accepted window.',
      'privacyNoticePresentedAt',
    );
  }

  let orderReference: string | undefined;
  if (value.orderReference !== undefined && value.orderReference !== null && value.orderReference !== '') {
    orderReference = cleanSingleLine(
      value.orderReference,
      'orderReference',
      CONTACT_ORDER_REFERENCE_MAX_LENGTH,
    );
    if (!isValidContactOrderReference(orderReference)) {
      throw new ContactValidationError('orderReference is invalid.', 'orderReference');
    }
  }

  const honeypot = typeof value.companyWebsite === 'string' ? value.companyWebsite.trim() : '';
  const trapped = honeypot.length > 0 || formAge < CONTACT_MIN_FILL_TIME_MS;
  return {
    email,
    formStartedAt,
    locale,
    message,
    name,
    orderReference,
    privacyNoticePresentedAt,
    privacyNoticeVersion: CONTACT_PRIVACY_NOTICE_VERSION,
    submissionId: value.submissionId,
    topic,
    trapped,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function detailRow(label: string, value: string, ltr = false): string {
  return `<tr><th scope="row" style="padding:10px 12px;text-align:inherit;vertical-align:top;border-bottom:1px solid rgba(23,19,10,.14);font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.7px;">${escapeHtml(label)}</th><td style="padding:10px 12px;vertical-align:top;border-bottom:1px solid rgba(23,19,10,.14);font-size:14px;line-height:21px;word-break:break-word;"${ltr ? ' dir="ltr"' : ''}>${escapeHtml(value)}</td></tr>`;
}

export function renderContactEmail(submission: ContactSubmission): ContactEmailContent {
  const copy = COPY[submission.locale];
  const direction = submission.locale === 'ar' ? 'rtl' : 'ltr';
  const orderRow = submission.orderReference
    ? detailRow(copy.labels.orderReference, submission.orderReference, true)
    : '';
  const subject = `${copy.title}: ${copy.topics[submission.topic]} — ${submission.name}`;
  const html = `<!doctype html>
<html lang="${submission.locale}" dir="${direction}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light only"><title>${escapeHtml(copy.title)}</title></head>
  <body style="margin:0;background:#f4eedc;color:#17130a;font-family:Arial,Helvetica,sans-serif;direction:${direction};text-align:${direction === 'rtl' ? 'right' : 'left'};">
    <div role="article" aria-roledescription="email" aria-label="${escapeHtml(copy.title)}" style="max-width:640px;margin:0 auto;padding:24px 12px;">
      <div style="background:#ffc800;border:3px solid #17130a;padding:22px 24px;">
        <div aria-label="PixBrik" style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;line-height:28px;font-weight:900;letter-spacing:-1px;">PIXBRIK<span style="color:#ff3d17;">.</span></div>
        <div style="margin-top:20px;font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</div>
        <h1 style="margin:6px 0 0;font-family:'Arial Black',Arial,sans-serif;font-size:30px;line-height:34px;letter-spacing:-.8px;">${escapeHtml(copy.title)}</h1>
        <p style="margin:12px 0 0;font-size:15px;line-height:23px;">${escapeHtml(copy.intro)}</p>
      </div>
      <div style="background:#ffffff;border:3px solid #17130a;border-top:0;padding:20px 18px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;color:#17130a;">
          ${detailRow(copy.labels.name, submission.name)}
          ${detailRow(copy.labels.email, submission.email, true)}
          ${detailRow(copy.labels.topic, copy.topics[submission.topic])}
          ${orderRow}
          ${detailRow(copy.labels.language, submission.locale.toUpperCase(), true)}
          ${detailRow(copy.labels.privacyNotice, submission.privacyNoticeVersion, true)}
          ${detailRow(copy.labels.privacyNoticePresentedAt, new Date(submission.privacyNoticePresentedAt).toISOString(), true)}
        </table>
        <h2 style="margin:24px 12px 8px;font-family:'Arial Black',Arial,sans-serif;font-size:17px;line-height:22px;">${escapeHtml(copy.labels.message)}</h2>
        <div style="margin:0 12px;padding:16px;background:#f4eedc;border-inline-start:5px solid #ff3d17;font-size:15px;line-height:24px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(submission.message)}</div>
        <p style="margin:22px 12px 0;font-size:11px;line-height:17px;color:#6a6252;" dir="ltr">Submission ${escapeHtml(submission.submissionId)}</p>
      </div>
    </div>
  </body>
</html>`;
  const lines = [
    'PIXBRIK',
    copy.title,
    '',
    copy.intro,
    '',
    `${copy.labels.name}: ${submission.name}`,
    `${copy.labels.email}: ${submission.email}`,
    `${copy.labels.topic}: ${copy.topics[submission.topic]}`,
    ...(submission.orderReference ? [`${copy.labels.orderReference}: ${submission.orderReference}`] : []),
    `${copy.labels.language}: ${submission.locale.toUpperCase()}`,
    `${copy.labels.privacyNotice}: ${submission.privacyNoticeVersion}`,
    `${copy.labels.privacyNoticePresentedAt}: ${new Date(submission.privacyNoticePresentedAt).toISOString()}`,
    '',
    `${copy.labels.message}:`,
    submission.message,
    '',
    `Submission: ${submission.submissionId}`,
  ];
  return { html, subject, text: lines.join('\n') };
}

export function contactIdempotencyKey(submission: ContactSubmission): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      submission.submissionId,
      submission.email,
      submission.name,
      submission.topic,
      submission.orderReference ?? '',
      submission.message,
      submission.locale,
      submission.privacyNoticeVersion,
      submission.privacyNoticePresentedAt,
    ]))
    .digest('hex')
    .slice(0, 24);
  return `pixbrik-contact-${submission.submissionId}-${digest}`;
}

function configuredMailbox(value: string | undefined, fallback: string, variable: string): string {
  const mailbox = value?.trim() || fallback;
  if (mailbox.length > 254 || /[\r\n\u0000]/.test(mailbox) || !mailbox.includes('@')) {
    throw new ContactServiceError(`${variable} is not configured correctly.`, 503, 'contact_not_configured');
  }
  return mailbox;
}

function isProductionDeployment(env: Record<string, string | undefined>): boolean {
  const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment) return vercelEnvironment === 'production';
  return env.NODE_ENV === 'production';
}

export interface ResendContactConfig {
  apiKey: string;
  from: string;
  recipient: string;
}

export function resendContactConfig(
  env: Record<string, string | undefined> = process.env,
): ResendContactConfig {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new ContactServiceError('Contact email is not configured.', 503, 'contact_not_configured');
  }
  const production = isProductionDeployment(env);
  const recipient = configuredMailbox(
    env.CONTACT_RECIPIENT_EMAIL,
    production ? 'hello@pixbrik.com' : '',
    'CONTACT_RECIPIENT_EMAIL',
  );
  if (
    !production &&
    recipient.toLowerCase() === 'hello@pixbrik.com' &&
    env.CONTACT_ALLOW_PRODUCTION_RECIPIENT_OUTSIDE_PRODUCTION !== 'true'
  ) {
    throw new ContactServiceError(
      'Production contact delivery is disabled outside production.',
      503,
      'contact_not_configured',
    );
  }
  return {
    apiKey,
    from: configuredMailbox(env.RESEND_FROM_EMAIL, 'PixBrik <hello@pixbrik.com>', 'RESEND_FROM_EMAIL'),
    recipient,
  };
}

export async function sendContactEmail(
  submission: ContactSubmission,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<void> {
  const config = resendContactConfig(options.env);
  const content = renderContactEmail(submission);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTACT_EMAIL_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      body: JSON.stringify({
        from: config.from,
        html: content.html,
        reply_to: submission.email,
        subject: content.subject,
        tags: [
          { name: 'source', value: 'contact_form' },
          { name: 'locale', value: submission.locale },
          { name: 'topic', value: submission.topic },
        ],
        text: content.text,
        to: [config.recipient],
      }),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': contactIdempotencyKey(submission),
        'User-Agent': 'PixBrik contact/1.0',
      },
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new ContactServiceError('Contact email is temporarily rate limited.', 429, 'contact_rate_limited');
      }
      if (response.status === 401 || response.status === 403) {
        throw new ContactServiceError('Contact email is not configured correctly.', 503, 'contact_not_configured');
      }
      throw new ContactServiceError('Contact email could not be delivered.', 502, 'contact_delivery_failed');
    }
  } catch (error) {
    if (error instanceof ContactServiceError) throw error;
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      throw new ContactServiceError('Contact email timed out.', 504, 'contact_timeout');
    }
    throw new ContactServiceError('Contact email could not be delivered.', 502, 'contact_delivery_failed');
  } finally {
    clearTimeout(timeout);
  }
}
