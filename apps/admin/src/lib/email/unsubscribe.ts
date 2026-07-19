import "server-only";

import { randomUUID } from "node:crypto";

import { withDatabaseRequestContext } from "@/lib/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UnsubscribeContact = Readonly<{
  maskedEmail: string;
  status: string;
  localeCode: UnsubscribeLocale;
}>;

export const UNSUBSCRIBE_LOCALES = ["en", "fr", "es", "it", "ar"] as const;
export type UnsubscribeLocale = (typeof UNSUBSCRIBE_LOCALES)[number];

export type UnsubscribeCopy = Readonly<{
  eyebrow: string;
  confirmTitle: string;
  confirmedTitle: string;
  confirmedBody: string;
  confirmBeforeEmail: string;
  confirmAfterEmail: string;
  confirmButton: string;
  invalidTitle: string;
  invalidBody: string;
  failureMessage: string;
  retryButton: string;
  homeLink: string;
}>;

const UNSUBSCRIBE_COPY: Readonly<Record<UnsubscribeLocale, UnsubscribeCopy>> = {
  en: {
    eyebrow: "PixBrik email preferences",
    confirmTitle: "Stop PixBrik news?",
    confirmedTitle: "You are unsubscribed.",
    confirmedBody:
      "No more newsletters or promotional recovery emails will be sent to this address. Essential order and account messages are unaffected.",
    confirmBeforeEmail: "Confirm that",
    confirmAfterEmail: "should stop receiving newsletters and promotional recovery emails.",
    confirmButton: "Confirm unsubscribe",
    invalidTitle: "This unsubscribe link cannot be used.",
    invalidBody:
      "The link may be invalid or no longer active. If you already unsubscribed, there is nothing else to do.",
    failureMessage: "We could not update your preferences just now. Nothing was changed. Please try again.",
    retryButton: "Try again",
    homeLink: "Return to PixBrik"
  },
  fr: {
    eyebrow: "Préférences e-mail PixBrik",
    confirmTitle: "Ne plus recevoir les actualités PixBrik ?",
    confirmedTitle: "Votre désinscription est confirmée.",
    confirmedBody:
      "Vous ne recevrez plus de newsletters ni d’e-mails promotionnels de relance. Les messages essentiels liés aux commandes et au compte restent actifs.",
    confirmBeforeEmail: "Confirmez que",
    confirmAfterEmail: "ne doit plus recevoir de newsletters ni d’e-mails promotionnels de relance.",
    confirmButton: "Confirmer la désinscription",
    invalidTitle: "Ce lien de désinscription ne peut pas être utilisé.",
    invalidBody:
      "Le lien est peut-être incorrect ou n’est plus actif. Si vous êtes déjà désinscrit, aucune autre action n’est nécessaire.",
    failureMessage:
      "Nous n’avons pas pu mettre à jour vos préférences. Rien n’a été modifié. Veuillez réessayer.",
    retryButton: "Réessayer",
    homeLink: "Retour à PixBrik"
  },
  es: {
    eyebrow: "Preferencias de correo de PixBrik",
    confirmTitle: "¿Dejar de recibir novedades de PixBrik?",
    confirmedTitle: "Tu baja está confirmada.",
    confirmedBody:
      "Ya no enviaremos boletines ni correos promocionales de recuperación a esta dirección. Los mensajes esenciales sobre pedidos y cuenta no se verán afectados.",
    confirmBeforeEmail: "Confirma que",
    confirmAfterEmail: "debe dejar de recibir boletines y correos promocionales de recuperación.",
    confirmButton: "Confirmar la baja",
    invalidTitle: "Este enlace de baja no se puede utilizar.",
    invalidBody:
      "Puede que el enlace no sea válido o que ya no esté activo. Si ya te diste de baja, no tienes que hacer nada más.",
    failureMessage:
      "No hemos podido actualizar tus preferencias. No se ha realizado ningún cambio. Inténtalo de nuevo.",
    retryButton: "Intentar de nuevo",
    homeLink: "Volver a PixBrik"
  },
  it: {
    eyebrow: "Preferenze e-mail PixBrik",
    confirmTitle: "Non vuoi più ricevere le novità di PixBrik?",
    confirmedTitle: "La disiscrizione è confermata.",
    confirmedBody:
      "Non invieremo più newsletter o e-mail promozionali di recupero a questo indirizzo. I messaggi essenziali relativi agli ordini e all’account non subiranno modifiche.",
    confirmBeforeEmail: "Conferma che",
    confirmAfterEmail: "non deve più ricevere newsletter ed e-mail promozionali di recupero.",
    confirmButton: "Conferma la disiscrizione",
    invalidTitle: "Questo link di disiscrizione non può essere utilizzato.",
    invalidBody:
      "Il link potrebbe non essere valido o non essere più attivo. Se hai già annullato l’iscrizione, non devi fare altro.",
    failureMessage:
      "Non è stato possibile aggiornare le preferenze. Non è stata apportata alcuna modifica. Riprova.",
    retryButton: "Riprova",
    homeLink: "Torna a PixBrik"
  },
  ar: {
    eyebrow: "تفضيلات رسائل PixBrik",
    confirmTitle: "هل تريد إيقاف رسائل PixBrik الإخبارية؟",
    confirmedTitle: "تم إلغاء اشتراكك.",
    confirmedBody:
      "لن نرسل النشرات الإخبارية أو رسائل التذكير الترويجية إلى هذا العنوان بعد الآن. لن تتأثر رسائل الطلبات والحساب الضرورية.",
    confirmBeforeEmail: "أكّد أن",
    confirmAfterEmail: "يجب ألا يتلقى النشرات الإخبارية أو رسائل التذكير الترويجية.",
    confirmButton: "تأكيد إلغاء الاشتراك",
    invalidTitle: "لا يمكن استخدام رابط إلغاء الاشتراك هذا.",
    invalidBody:
      "قد يكون الرابط غير صالح أو لم يعد نشطًا. إذا كنت قد ألغيت اشتراكك بالفعل، فلا يلزمك اتخاذ أي إجراء آخر.",
    failureMessage:
      "تعذر تحديث تفضيلاتك الآن. لم يتم إجراء أي تغيير. يرجى المحاولة مرة أخرى.",
    retryButton: "المحاولة مرة أخرى",
    homeLink: "العودة إلى PixBrik"
  }
};

export function normalizeUnsubscribeLocale(localeCode: string | null | undefined): UnsubscribeLocale {
  const baseLocale = localeCode?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return UNSUBSCRIBE_LOCALES.includes(baseLocale as UnsubscribeLocale)
    ? (baseLocale as UnsubscribeLocale)
    : "en";
}

export function getUnsubscribeCopy(localeCode: string | null | undefined): UnsubscribeCopy {
  return UNSUBSCRIBE_COPY[normalizeUnsubscribeLocale(localeCode)];
}

function mask(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, Math.min(2, local.length))}${local.length > 2 ? "***" : "*"}@${domain}`;
}

export function validUnsubscribeToken(token: string): boolean {
  return UUID_PATTERN.test(token);
}

export async function loadUnsubscribeContact(token: string): Promise<UnsubscribeContact | null> {
  if (!validUnsubscribeToken(token)) return null;
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const [contact] = await sql<{ email: string; status: string; locale_code: string }[]>`
      SELECT email, status, locale_code
      FROM pixbrik.marketing_contact
      WHERE unsubscribe_token = ${token}::uuid
      LIMIT 1
    `;
    return contact
      ? {
          maskedEmail: mask(contact.email),
          status: contact.status,
          localeCode: normalizeUnsubscribeLocale(contact.locale_code)
        }
      : null;
  });
}

export async function unsubscribeMarketing(token: string, source: string): Promise<boolean> {
  if (!validUnsubscribeToken(token)) return false;
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const rows = await sql<{ contact_id: string }[]>`
      SELECT contact_id::text
      FROM pixbrik.unsubscribe_marketing_contact(
        ${token}::uuid, ${source.slice(0, 120)}, ${randomUUID()}::uuid
      )
    `;
    return rows.length === 1;
  });
}
