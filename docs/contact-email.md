# Contact email setup

The public contact form posts JSON to `POST /api/contact`. The server validates
the message and sends a branded plain-text and HTML notification to PixBrik
through Resend. No Resend credential is compiled into the Expo application.

This is the buyer-app contact notification, not the backoffice lifecycle email
queue. The backoffice has its own database role, signed Resend webhook,
suppression handling, cron secret and disabled-by-default automations; configure
those separately using the [admin email runbook](../apps/admin/README.md#resend-lifecycle-email-setup).

## Vercel environment variables

Add these values to the Vercel **Production** environment:

```text
RESEND_API_KEY=re_your_private_resend_key
RESEND_FROM_EMAIL=PixBrik <hello@pixbrik.com>
CONTACT_RECIPIENT_EMAIL=hello@pixbrik.com
CONTACT_ALLOWED_ORIGINS=https://pixbrik.com,https://www.pixbrik.com
PIXBRIK_APP_URL=https://pixbrik.com
EXPO_PUBLIC_APP_URL=https://pixbrik.com
```

For this contact endpoint, `RESEND_API_KEY` is the only secret in the list
above. It must never use an `EXPO_PUBLIC_` prefix.
`EXPO_PUBLIC_APP_URL` is intentionally public and is required by native Expo
builds so they can call the absolute `https://pixbrik.com/api/contact` URL. A
native build fails closed if it is missing or invalid; web builds use the
same-origin `/api/contact` path.

Verify `pixbrik.com` in Resend before using `hello@pixbrik.com` as the sender.
For an isolated sender reputation, Resend may instead verify a subdomain such
as `mail.pixbrik.com`; the visible From mailbox can then be updated here after
the DNS configuration is approved.

Preview and Development deployments must use a separate Resend key and an
explicit non-production recipient, for example:

```text
RESEND_API_KEY=re_your_preview_only_key
RESEND_FROM_EMAIL=PixBrik Preview <preview@verified-preview-domain.example>
CONTACT_RECIPIENT_EMAIL=pixbrik-preview@example.net
CONTACT_ALLOWED_ORIGINS=https://your-preview.vercel.app
```

Non-production deployments do not default to `hello@pixbrik.com`. They also
reject that production recipient when it is explicitly supplied. A deliberate,
temporary end-to-end test may opt in with
`CONTACT_ALLOW_PRODUCTION_RECIPIENT_OUTSIDE_PRODUCTION=true`; remove it
immediately after the test. Never set that override globally across Vercel
environments.

The active Vercel preview and branch hostnames are accepted automatically from
Vercel's system environment variables.

## Abuse controls — launch blocker

The endpoint has request-size validation, strict fields, same-origin browser
checks, a hidden `companyWebsite` honeypot, a minimum completion time, a warm
function rate limiter, and Resend idempotency. **Production launch is blocked
until a distributed Vercel Firewall rate-limit rule is enabled for
`POST /api/contact`, keyed by source IP.** The in-process limiter is
intentionally not a distributed security boundary and does not satisfy this
launch gate.

Recommended initial Firewall policy: five POST requests per source IP per ten
minutes, with monitoring before making it stricter. Do not log message bodies,
email addresses, or raw source IPs.

## Frontend integration contract

When the contact screen opens, record `formStartedAt = Date.now()`, record the
exact `privacyNoticePresentedAt`, and create a single `submissionId` with
`createContactSubmissionId()`. Keep all three unchanged if a network retry is
needed. Retries older than 23 hours are rejected so the accepted request window
stays below Resend's 24-hour idempotency window. Render `companyWebsite` as an
off-screen, non-tabbable honeypot and leave it empty for real visitors.

Call `submitContactForm()` with:

- `name` (maximum 100), `email` (maximum 254), and a message of 20–5,000 characters;
- locale `en`, `fr`, `es`, `it`, or `ar`;
- topic `general`, `order`, `wrong-damaged`, `billing`, `partnership`, `press`,
  `privacy`, or `other`;
- an optional PixBrik order reference of up to 50 ASCII letters, numbers,
  spaces, underscores, or hyphens;
- `privacyNoticeVersion: "contact-support-privacy-2026-07-18-v1"` and the exact
  `privacyNoticePresentedAt` timestamp;
- the original `formStartedAt`, `submissionId`, and empty honeypot value.

The privacy copy is a notice explaining the processing needed to answer the
request. It is not an optional consent checkbox. The server records the notice
version and presentation time in both the request model and the email so the
presented wording is auditable.

Translate `messageKey: "contact.received"` in the app. Network failures,
aborts, invalid service responses, validation failures, and configuration
failures are normalized as `ContactFormRequestError`; translate its `code` and
optional `field` and never display provider details. The Arabic contact screen
must set right-to-left layout while preserving email and order-reference fields
as left-to-right text. Subject-bound customer values reject Unicode bidi
control characters to prevent visually spoofed mail headers.
