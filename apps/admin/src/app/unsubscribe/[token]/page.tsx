import Link from "next/link";

import { confirmUnsubscribeAction } from "@/app/unsubscribe/[token]/actions";
import {
  getUnsubscribeCopy,
  loadUnsubscribeContact,
  type UnsubscribeContact
} from "@/lib/email/unsubscribe";

type UnsubscribePageProps = Readonly<{
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string | string[] }>;
}>;

export default async function UnsubscribePage({ params, searchParams }: UnsubscribePageProps) {
  const { token } = await params;
  const query = await searchParams;
  const resultValue = Array.isArray(query.result) ? query.result[0] : query.result;
  const failed = resultValue === "failed";
  let contact: UnsubscribeContact | null = null;
  let loadFailed = false;
  try {
    contact = await loadUnsubscribeContact(token);
  } catch {
    loadFailed = true;
  }

  const locale = contact?.localeCode ?? "en";
  const copy = getUnsubscribeCopy(locale);
  const inactive = contact?.status === "unsubscribed";
  const confirmed = inactive;
  const unusable = !contact && !loadFailed;
  const showFailure = failed || loadFailed;
  const canSubmit = Boolean(contact && !inactive);

  return (
    <main className="public-page" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="public-card unsubscribe-card">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>
          {confirmed ? copy.confirmedTitle : unusable ? copy.invalidTitle : copy.confirmTitle}
        </h1>
        {confirmed ? <p>{copy.confirmedBody}</p> : null}
        {unusable ? <p>{copy.invalidBody}</p> : null}
        {!confirmed && !unusable && contact ? (
          <p>
            {copy.confirmBeforeEmail}{" "}
            <bdi dir="ltr">{contact.maskedEmail}</bdi>{" "}
            {copy.confirmAfterEmail}
          </p>
        ) : null}
        {showFailure ? (
          <p className="staff-message staff-message-error" role="alert">
            {copy.failureMessage}
          </p>
        ) : null}
        {canSubmit && !confirmed ? (
          <form action={confirmUnsubscribeAction.bind(null, token)}>
            <button className="primary-link" type="submit">
              {showFailure ? copy.retryButton : copy.confirmButton}
            </button>
          </form>
        ) : null}
        <Link className="staff-text-link unsubscribe-home-link" href="https://www.pixbrik.com">
          {copy.homeLink}
        </Link>
      </section>
    </main>
  );
}
