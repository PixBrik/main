# Checkout recovery runtime status

## What works now

The buyer demo saves an exact checkout draft in that browser for 30 days. The
snapshot contains the selected voxel model, build identity, product, size/detail
variant, hollow/full choice, colour mode, country, delivery estimate and the
displayed quote. It deliberately excludes source photos and is removed when the
demo order is created.

The address `/checkout?draft=pbd_...` restores that snapshot on the same device.
The opaque identifier is generated from 128 bits of browser cryptographic
randomness. Stored records are size-bounded and validated before use. Invalid or
expired records fail closed.

This is a convenience cache, not an account-synced cart. Prices are always
marked for server repricing and the checkout UI explicitly says that no recovery
email is sent.

## Why email recovery remains disabled

Production recovery must not be enabled until all of these are true:

1. The buyer Clerk instance is configured and buyer API routes verify Clerk
   tokens server-side. The current production buyer bundle has no Clerk key.
2. A verified Clerk subject is safely mapped to a customer `app_user`. Never
   trust a customer ID or email supplied in a JSON request body.
3. Builds and approved revisions are persisted in private server storage. A
   local gallery ID is not a durable `build_version_id`.
4. An authoritative server checkout draft freezes configuration and reprices
   inventory, shipping, FX, tax and discounts before payment.
5. A same-origin, authenticated capture endpoint writes `checkout_recovery`
   using the restricted service database role. It must have a strict body-size
   limit, schema validation, idempotency, distributed per-customer/IP rate
   limiting, origin checks and audit logging.
6. The checkout presents an unchecked, localized marketing/recovery consent
   control where required. Consent evidence must include policy version,
   timestamp, locale, source and an idempotent request ID. Order-service emails
   and marketing emails must remain separate.
7. The lifecycle template receives a real resume destination. The current
   abandoned-checkout template points to `/account`; the stored recovery token
   is a digest and cannot be reconstructed. Prefer an authenticated
   `/checkout/recovery/{recovery-id}` lookup that verifies the signed-in customer
   and performs server repricing before returning any state.
8. Payment/order completion atomically marks the recovery converted so queued
   messages are suppressed.
9. Cross-device resume, unsubscribe, bounce/complaint suppression, cron cadence
   and the complete capture → email → resume → conversion path pass production
   browser tests.

Until then, keep `CHECKOUT_RECOVERY_EMAIL_READY=false` and the abandoned-checkout
automation disabled. Enabling only the sender or cron would send a promise the
storefront cannot fulfil.
